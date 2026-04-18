/**
 * SONEC Inline Completion Provider
 * 
 * The VS Code integration point that provides inline completions.
 * Implements `vscode.InlineCompletionItemProvider` with:
 * - Debounced triggering
 * - Cancellation support
 * - Prefetch speculation
 * - Partial acceptance tracking
 * - Ghost text rendering
 */

import * as vscode from 'vscode';
import { CompletionResult, ProjectContext } from '../core/types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { ContextEngine } from '../context/context-engine';
import { PredictionEngine } from '../prediction/prediction-engine';
import { PerformanceMonitor } from '../performance/performance-monitor';

/**
 * Provides inline completions for the SONEC extension.
 */
export class SonecCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private config: ConfigManager;
  private logger: Logger;
  private eventBus: EventBus;
  private contextEngine: ContextEngine;
  private predictionEngine: PredictionEngine;
  private perfMonitor: PerformanceMonitor;

  /** Currently shown completion (for partial acceptance) */
  private currentCompletion: CompletionResult | null = null;
  /** Offset into the current completion text (for partial acceptance) */
  private acceptedOffset = 0;
  /** Debounce timer handle */
  private debounceTimer: NodeJS.Timeout | null = null;
  /** Last triggered position (to detect movement) */
  private lastPosition: vscode.Position | null = null;
  /** Prefetch completion for speculative next position */
  private prefetchResult: {
    key: string;
    result: CompletionResult;
  } | null = null;

  constructor(
    contextEngine: ContextEngine,
    predictionEngine: PredictionEngine,
    perfMonitor: PerformanceMonitor
  ) {
    this.config = ConfigManager.getInstance();
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
    this.contextEngine = contextEngine;
    this.predictionEngine = predictionEngine;
    this.perfMonitor = perfMonitor;
  }

  /**
   * Main entry point called by VS Code when inline completions are needed
   * Enhanced with intelligent fallbacks for minimal context
   * @param document The current text document
   * @param position The current cursor position
   * @param context The completion context
   * @param token The cancellation token
   * @returns A promise that resolves to an array of inline completion items or null
   */
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    // Bail if disabled or not ready
    if (!this.config.isReady()) {
      return null;
    }

    // Skip non-code files
    if (this.isExcludedLanguage(document.languageId)) {
      return null;
    }

    // Track position for movement detection
    this.lastPosition = position;

    try {
      this.eventBus.emit({
        type: 'completion_triggered',
        data: {
          file: document.uri.fsPath,
          position,
        },
      });

      // Speculative latency reduction
      // If we have a prefetch for this exact position, use it immediately
      const prefetchKey = `${document.uri.fsPath}:${position.line}:${position.character}`;
      if (this.prefetchResult && this.prefetchResult.key === prefetchKey) {
        this.logger.debug('Using prefetched completion');
        return [this.createInlineItem(this.prefetchResult.result, position, document)];
      }

      // Build deep context
      const projectContext = await this.contextEngine.buildContext(
        document,
        position,
        token
      );

      if (token.isCancellationRequested) {
        return null;
      }

      // Get completion from prediction engine
      const startTime = Date.now();
      let completion = await this.predictionEngine.getCompletion(
        projectContext,
        token
      );

      // Enhanced fallback: If no completion, try intelligent contextual suggestions
      if (!completion && !token.isCancellationRequested) {
        completion = await this.generateIntelligentFallback(
          document,
          position,
          projectContext,
          token
        );
      }

      if (!completion || token.isCancellationRequested) {
        this.logger.debug('No completion generated or cancellation requested');
        return null;
      }

      // Record performance
      const latency = Date.now() - startTime;
      this.perfMonitor.recordLatency('completion', latency);

      // Store current completion for partial acceptance
      this.currentCompletion = completion;
      this.acceptedOffset = 0;

      // Create an item that can replace the current block if needed
      const item = this.createInlineItem(completion, position, document);

      this.eventBus.emit({
        type: 'completion_shown',
        data: {
          id: completion.id,
          confidence: completion.confidence,
        },
      });

      this.logger.debug(
        `Completion provided: ${completion.insertText.length} chars, ${latency}ms, confidence: ${completion.confidence.toFixed(2)}`
      );

      // Trigger prefetch for likely next position
      if (this.config.getValue('prefetchEnabled')) {
        this.schedulePrefetch(document, position);
      }

      return [item];
    } catch (err: any) {
      if (err.name === 'AbortError') {
          this.logger.debug('Completion request cancelled by user or engine');
          return null;
      }
      this.logger.error('Completion provider failed', err);
      return null;
    }
  }

  /**
   * Intelligent Range Calculation
   * Detects if we should replace the rest of the line or block
   * @param completion The completion result
   * @param position The current cursor position
   * @param document The current text document
   * @returns The inline completion item
   */
  private createInlineItem(
    completion: CompletionResult,
    position: vscode.Position,
    document: vscode.TextDocument
  ): vscode.InlineCompletionItem {
    let range = new vscode.Range(position, position);

    // If the model provides a specific range for an edit, use it
    if (completion.range) {
       range = completion.range;
    } else {
      // Heuristic: If we're at the start of a line and it's mostly empty/messy,
      // overwrite the whole line to provide a clean refactor.
      const lineText = document.lineAt(position.line).text;
      if (lineText.trim().length < 5 || position.character === 0) {
        range = new vscode.Range(position, document.lineAt(position.line).range.end);
      }
    }

    const item = new vscode.InlineCompletionItem(completion.insertText, range);
    
    // Command to trigger after acceptance
    item.command = {
        title: 'SONEC: Post-Acceptance Hook',
        command: 'sonec.onCompletionAccepted',
        arguments: [completion]
    };

    return item;
  }

  /**
   * Accept the next word from the current completion
   * @returns A promise that resolves to true if successful
   */
  async acceptWord(): Promise<boolean> {
    if (!this.currentCompletion) {return false;}

    const remaining = this.currentCompletion.insertText.substring(
      this.acceptedOffset
    );
    if (!remaining) {return false;}

    // Find next word boundary
    const wordMatch = remaining.match(/^\s*\S+/);
    if (!wordMatch) {return false;}

    const wordText = wordMatch[0];
    this.acceptedOffset += wordText.length;

    // Insert the word
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, wordText);
      });
    }

    this.eventBus.emit({
      type: 'completion_accepted',
      data: { id: this.currentCompletion.id, partial: true },
    });

    return true;
  }

  /**
   * Accept the next line from the current completion
   * @returns A promise that resolves to true if successful
   */
  async acceptLine(): Promise<boolean> {
    if (!this.currentCompletion) {return false;}

    const remaining = this.currentCompletion.insertText.substring(
      this.acceptedOffset
    );
    if (!remaining) {return false;}

    // Find next line boundary
    const lineEnd = remaining.indexOf('\n');
    const lineText =
      lineEnd >= 0
        ? remaining.substring(0, lineEnd + 1)
        : remaining;

    this.acceptedOffset += lineText.length;

    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit((editBuilder) => {
        editBuilder.insert(editor.selection.active, lineText);
      });
    }

    this.eventBus.emit({
      type: 'completion_accepted',
      data: { id: this.currentCompletion.id, partial: true },
    });

    return true;
  }

  /**
   * Accept the full remaining completion
   * @returns A promise that resolves to true if successful
   */
  async acceptFull(): Promise<boolean> {
    if (!this.currentCompletion) {return false;}

    this.perfMonitor.recordAccepted();

    this.eventBus.emit({
      type: 'completion_accepted',
      data: { id: this.currentCompletion.id, partial: false },
    });

    this.currentCompletion = null;
    this.acceptedOffset = 0;

    return true;
  }

  /**
   * Dismiss the current completion
   */
  dismiss(): void {
    if (this.currentCompletion) {
      this.perfMonitor.recordDismissed();

      this.eventBus.emit({
        type: 'completion_dismissed',
        data: {
          id: this.currentCompletion.id,
          reason: 'user_dismissed',
        },
      });
    }

    this.currentCompletion = null;
    this.acceptedOffset = 0;
  }

  /**
   * Get the current completion (if any)
   * @returns The current completion result or null
   */
  getCurrentCompletion(): CompletionResult | null {
    return this.currentCompletion;
  }

  /**
   * Speculatively prefetch completion for likely next cursor position
   * @param document The current text document
   * @param currentPosition The current cursor position
   */
  private schedulePrefetch(
    document: vscode.TextDocument,
    currentPosition: vscode.Position
  ): void {
    // Prefetch for the position after accepting the current completion
    if (!this.currentCompletion) {return;}

    const insertText = this.currentCompletion.insertText;
    const lines = insertText.split('\n');
    const endLine = currentPosition.line + lines.length - 1;
    const endChar =
      lines.length === 1
        ? currentPosition.character + insertText.length
        : lines[lines.length - 1].length;

    const nextPosition = new vscode.Position(endLine, endChar);

    // Delay prefetch to avoid interfering with current completion
    setTimeout(async () => {
      try {
        const cts = new vscode.CancellationTokenSource();
        // Cancel after 5 seconds
        setTimeout(() => cts.cancel(), 5000);

        const context = await this.contextEngine.buildContext(
          document,
          nextPosition,
          cts.token
        );

        const result = await this.predictionEngine.getCompletion(
          context,
          cts.token
        );

        if (result) {
          const key = `${document.uri.fsPath}:${nextPosition.line}:${nextPosition.character}`;
          this.prefetchResult = { key, result };
          this.logger.debug(`Prefetched completion for ${key}`);
        }

        cts.dispose();
      } catch {
        // Prefetch failures are non-critical
      }
    }, 200);
  }

  /**
   * Generate intelligent fallback completions when model fails
   * @param document The current text document
   * @param position The current cursor position
   * @param context The project context
   * @param token The cancellation token
   * @returns A completion result or null
   */
  private async generateIntelligentFallback(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: ProjectContext,
    token: vscode.CancellationToken
  ): Promise<CompletionResult | null> {
    const lineText = document.lineAt(position.line).text;
    const prefix = lineText.substring(0, position.character);
    const suffix = lineText.substring(position.character);

    // 1. Basic keyword and pattern matching
    const keywordCompletion = this.generateKeywordCompletion(document.languageId, prefix, suffix, context);
    if (keywordCompletion) {
      return keywordCompletion;
    }

    // 2. Symbol-based completions from context
    const symbolCompletion = this.generateSymbolCompletion(prefix, suffix, context);
    if (symbolCompletion) {
      return symbolCompletion;
    }

    // 3. Import suggestions
    const importCompletion = this.generateImportCompletion(document.languageId, prefix, context);
    if (importCompletion) {
      return importCompletion;
    }

    // 4. Template-based completions for empty contexts
    const templateCompletion = this.generateTemplateCompletion(document.languageId, prefix, context);
    if (templateCompletion) {
      return templateCompletion;
    }

    return null;
  }

  /**
   * Generate keyword-based completions
   */
  private generateKeywordCompletion(
    languageId: string,
    prefix: string,
    suffix: string,
    context: ProjectContext
  ): CompletionResult | null {
    const keywords = this.getLanguageKeywords(languageId);
    const matches = keywords.filter(k => k.startsWith(prefix) && !suffix.startsWith(k.substring(prefix.length)));
    
    if (matches.length > 0) {
      const bestMatch = matches[0];
      const completion = bestMatch.substring(prefix.length);
      return {
        id: this.generateId(),
        text: completion,
        insertText: completion,
        range: new vscode.Range(
          context.currentFile.position,
          context.currentFile.position
        ),
        confidence: 0.6,
        source: 'inline',
        metadata: {
          modelLatencyMs: 0,
          contextTokens: 0,
          completionTokens: completion.length,
          cached: false,
        },
      };
    }

    return null;
  }

  /**
   * Generate symbol-based completions from project context
   */
  private generateSymbolCompletion(
    prefix: string,
    suffix: string,
    context: ProjectContext
  ): CompletionResult | null {
    const matches = context.symbols.filter((s: any) => 
      s.name.startsWith(prefix) && 
      !suffix.startsWith(s.name.substring(prefix.length))
    );

    if (matches.length > 0) {
      const bestMatch = matches[0];
      const completion = bestMatch.name.substring(prefix.length);
      return {
        id: this.generateId(),
        text: completion,
        insertText: completion,
        range: new vscode.Range(
          context.currentFile.position,
          context.currentFile.position
        ),
        confidence: 0.7,
        source: 'inline',
        metadata: {
          modelLatencyMs: 0,
          contextTokens: 0,
          completionTokens: completion.length,
          cached: false,
        },
      };
    }

    return null;
  }

  /**
   * Generate import suggestions
   */
  private generateImportCompletion(
    languageId: string,
    prefix: string,
    context: ProjectContext
  ): CompletionResult | null {
    if (!prefix.includes('import') && !prefix.includes('require')) {
      return null;
    }

    const commonImports = this.getCommonImports(languageId);
    const matches = commonImports.filter(imp => prefix.includes(imp.split(' ')[1]));
    
    if (matches.length > 0) {
      const completion = matches[0].substring(prefix.length);
      return {
        id: this.generateId(),
        text: completion,
        insertText: completion,
        range: new vscode.Range(
          context.currentFile.position,
          context.currentFile.position
        ),
        confidence: 0.65,
        source: 'inline',
        metadata: {
          modelLatencyMs: 0,
          contextTokens: 0,
          completionTokens: completion.length,
          cached: false,
        },
      };
    }

    return null;
  }

  /**
   * Generate template completions for empty contexts
   */
  private generateTemplateCompletion(
    languageId: string,
    prefix: string,
    context: ProjectContext
  ): CompletionResult | null {
    const templates = this.getLanguageTemplates(languageId);
    const trimmedPrefix = prefix.trim();
    
    for (const template of templates) {
      if (trimmedPrefix === '' || template.trigger.startsWith(trimmedPrefix)) {
        const completion = template.body;
        return {
          id: this.generateId(),
          text: completion,
          insertText: completion,
          range: new vscode.Range(
            context.currentFile.position,
            context.currentFile.position
          ),
          confidence: 0.5,
          source: 'block',
          metadata: {
            modelLatencyMs: 0,
            contextTokens: 0,
            completionTokens: completion.length,
            cached: false,
          },
        };
      }
    }

    return null;
  }

  /**
   * Get language-specific keywords
   */
  private getLanguageKeywords(languageId: string): string[] {
    const keywordMap: Record<string, string[]> = {
      'typescript': ['function', 'class', 'interface', 'type', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'async', 'await', 'import', 'export', 'default', 'from', 'as'],
      'javascript': ['function', 'class', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'async', 'await', 'import', 'export', 'default', 'from', 'as'],
      'python': ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'import', 'from', 'return', 'yield', 'lambda', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False'],
      'java': ['public', 'private', 'protected', 'static', 'final', 'abstract', 'class', 'interface', 'extends', 'implements', 'import', 'package', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super'],
      'cpp': ['int', 'float', 'double', 'char', 'bool', 'void', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'throw', 'new', 'delete', 'this', 'class', 'struct', 'namespace', 'using', 'include'],
      'c': ['int', 'float', 'double', 'char', 'void', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'struct', 'union', 'enum', 'include', 'define'],
    };
    
    return keywordMap[languageId] || [];
  }

  /**
   * Get common imports for a language
   */
  private getCommonImports(languageId: string): string[] {
    const importMap: Record<string, string[]> = {
      'typescript': [
        'import React from "react"',
        'import { useState, useEffect } from "react"',
        'import { Component } from "react"',
        'import axios from "axios"',
        'import fs from "fs"',
        'import path from "path"'
      ],
      'javascript': [
        'import React from "react"',
        'import { useState, useEffect } from "react"',
        'import axios from "axios"',
        'const fs = require("fs")',
        'const path = require("path")'
      ],
      'python': [
        'import numpy as np',
        'import pandas as pd',
        'import matplotlib.pyplot as plt',
        'from typing import List, Dict, Optional',
        'import requests',
        'import json'
      ]
    };
    
    return importMap[languageId] || [];
  }

  /**
   * Get language-specific templates
   */
  private getLanguageTemplates(languageId: string): Array<{trigger: string, body: string}> {
    const templateMap: Record<string, Array<{trigger: string, body: string}>> = {
      'typescript': [
        { trigger: 'function', body: 'function functionName() {\n  // TODO: Implement\n}' },
        { trigger: 'class', body: 'class ClassName {\n  constructor() {\n    // TODO: Initialize\n  }\n}' },
        { trigger: 'interface', body: 'interface InterfaceName {\n  property: string;\n}' },
        { trigger: '', body: 'function main() {\n  // TODO: Implement main logic\n}' }
      ],
      'javascript': [
        { trigger: 'function', body: 'function functionName() {\n  // TODO: Implement\n}' },
        { trigger: 'class', body: 'class ClassName {\n  constructor() {\n    // TODO: Initialize\n  }\n}' },
        { trigger: '', body: 'function main() {\n  // TODO: Implement main logic\n}' }
      ],
      'python': [
        { trigger: 'def', body: 'def function_name():\n    """TODO: Add docstring"""\n    pass' },
        { trigger: 'class', body: 'class ClassName:\n    """TODO: Add docstring"""\n    def __init__(self):\n        pass' },
        { trigger: '', body: 'def main():\n    """Main entry point"""\n    pass\n\nif __name__ == "__main__":\n    main()' }
      ]
    };
    
    return templateMap[languageId] || [];
  }

  /**
   * Generate a unique ID for fallback completions
   */
  private generateId(): string {
    return `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if the language is excluded from completions
   * @param langId The language ID
   * @returns True if the language is excluded
   */
  private isExcludedLanguage(langId: string): boolean {
    const excluded = [
      'plaintext',
      'log',
      'output',
      'binary',
      'search-result',
      'scm-input',
    ];
    return excluded.includes(langId);
  }
}
