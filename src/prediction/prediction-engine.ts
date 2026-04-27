/**
 * AutoCode Prediction Engine
 * 
 * Core intelligence that transforms context into code completions.
 */

import * as vscode from 'vscode';
import {
  CompletionResult,
  ProjectContext,
} from '../core/types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { ModelLayer } from '../models/model-layer';
import { PromptBuilder } from '../models/prompt-builder';
import { CompletionCache } from '../cache/completion-cache';

/**
 * Manages the generation and processing of code completions.
 */
export class PredictionEngine implements vscode.Disposable {
  private config: ConfigManager;
  private logger: Logger;
  private eventBus: EventBus;
  private modelLayer: ModelLayer;
  private promptBuilder: PromptBuilder;
  private cache: CompletionCache;
  private recentRejections: Array<{text: string; file?: string; line?: number; timestamp: number}> = [];
  private idCounter = 0;

  constructor(modelLayer: ModelLayer) {
    this.config = ConfigManager.getInstance();
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
    this.modelLayer = modelLayer;
    this.promptBuilder = new PromptBuilder();
    this.cache = new CompletionCache();

    // Listen for negative feedback
    this.eventBus.on('completion_dismissed', (data: any) => {
        if (data.text) {
            this.recentRejections.push({
                text: data.text,
                file: data.file,
                line: data.line,
                timestamp: Date.now()
            });
            if (this.recentRejections.length > 20) this.recentRejections.shift();
        }
    });
  }

  /**
   * Generate inline completion for the current cursor position.
   */
  async getCompletion(
    context: ProjectContext,
    token: vscode.CancellationToken
  ): Promise<CompletionResult | null> {
    const timer = this.logger.time('PredictionEngine.getCompletion');

    try {
      // Check cache first
      const cacheKey = this.buildCacheKey(context);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.eventBus.emit({ type: 'cache_hit', data: { key: cacheKey } });
        timer();
        return {
          ...cached,
          metadata: { ...cached.metadata, cached: true },
        };
      }

      if (token.isCancellationRequested) {return null;}

      // Build prompt
      let prompt = this.promptBuilder.buildCompletionPrompt(context);

      // Inject Negative Feedback
      const relevantRejections = this.recentRejections.filter(r => 
        Date.now() - r.timestamp < 300000 && 
        (!r.file || r.file === context.currentFile.file.relativePath) && 
        (!r.line || Math.abs(r.line - context.currentFile.position.line) <= 2)
      );

      if (relevantRejections.length > 0) {
          const rejectedText = relevantRejections.map(r => r.text).join('\n---\n');
          prompt += `\n\n[NEGATIVE FEEDBACK]:\nThe user explicitly REJECTED the following suggestions here. DO NOT generate these strings again:\n${rejectedText}\n[END NEGATIVE FEEDBACK]\n\n`;
      }
      const startTime = Date.now();
      let completionText = '';

      if (this.config.getValue('streamingEnabled')) {
        await this.modelLayer.stream(
          {
            prompt,
            systemPrompt: undefined,
            maxTokens: this.calculateMaxTokens(context),
            temperature: 0.1,
            stopSequences: this.getStopSequences(context),
            stream: true,
          },
          (chunk) => {
            completionText += chunk.text;
          },
          token
        );
      } else {
        const response = await this.modelLayer.complete({
          prompt,
          maxTokens: this.calculateMaxTokens(context),
          temperature: 0.1,
          stopSequences: this.getStopSequences(context),
          stream: false,
        });
        completionText = response.text;
      }

      if (token.isCancellationRequested || !completionText.trim()) {
        timer();
        return null;
      }

      // Post-process completion
      completionText = this.postProcess(completionText, context);

      if (!completionText.trim()) {
        timer();
        return null;
      }

      const latencyMs = Date.now() - startTime;
      const result: CompletionResult = {
        id: this.generateId(),
        text: completionText,
        insertText: completionText,
        range: new vscode.Range(
          context.currentFile.position,
          context.currentFile.position
        ),
        confidence: this.estimateConfidence(completionText, context),
        source: completionText.includes('\n') ? 'block' : 'inline',
        metadata: {
          modelLatencyMs: latencyMs,
          contextTokens: Math.ceil(prompt.length / 4),
          completionTokens: Math.ceil(completionText.length / 4),
          cached: false,
        },
      };

      // Cache the result
      this.cache.set(cacheKey, result);

      timer();
      return result;
    } catch (err: any) {
      if (err.name === 'AbortError') {
          return null;
      }
      this.logger.error('Completion provider failed', err);
      return null;
    }
  }

  public dispose(): void {
    this.cache.dispose();
  }

  /**
   * Enhanced post-processing with better context awareness
   */
  private postProcess(text: string, context: ProjectContext): string {
    let processed = text;

    // Remove markdown code block markers
    processed = processed.replace(/^```\w*\n?/gm, '');
    processed = processed.replace(/\n?```$/gm, '');

    // Remove common model artifacts
    processed = processed.replace(/^<\/?code>/gm, '');
    processed = processed.replace(/^[#\s]*TODO:.*$/gm, '');

    // Enhanced duplicate stripping
    const prefix = context.currentFile.linePrefix.trim();
    if (prefix && processed.trim().startsWith(prefix)) {
        const prefixIdx = processed.indexOf(prefix);
        if (prefixIdx !== -1) {
            processed = processed.slice(prefixIdx + prefix.length);
        }
    }

    // Smart truncation
    processed = this.smartTruncate(processed, context);

    // Don't duplicate text that already exists after the cursor
    const suffix = context.currentFile.lineSuffix.trim();
    if (suffix && processed.endsWith(suffix)) {
      processed = processed.slice(0, -suffix.length);
    }

    // Enhanced indentation handling
    processed = this.fixIndentation(processed, context);

    // Remove incomplete code
    processed = this.cleanupIncompleteCode(processed, context);

    return processed;
  }

  private smartTruncate(text: string, context: ProjectContext): string {
    const maxLines = this.config.getValue('maxCompletionLines');
    const lines = text.split('\n');
    
    if (lines.length <= maxLines) {
      return text;
    }

    const breakPoints = [
      /^\s*}\s*$/,
      /^\s*\);\s*$/,
      /^\s*;\s*$/,
      /^\s*$/
    ];

    for (let i = maxLines - 1; i >= Math.max(0, maxLines - 10); i--) {
      const line = lines[i];
      if (breakPoints.some(pattern => pattern.test(line))) {
        return lines.slice(0, i + 1).join('\n');
      }
    }

    return lines.slice(0, maxLines).join('\n');
  }

  private fixIndentation(text: string, context: ProjectContext): string {
    const lines = text.split('\n');
    
    return lines
      .map((line, i) => {
        if (i === 0) return line;
        if (!line.trim()) return line;
        
        const leadingWhitespace = line.match(/^[ \t]*/)?.[0] || '';
        const strippedLine = line.substring(leadingWhitespace.length);
        
        if (context.projectStyle.indentation === 'spaces') {
          const indentLevel = Math.floor(leadingWhitespace.length / context.projectStyle.indentSize);
          return ' '.repeat(indentLevel * context.projectStyle.indentSize) + strippedLine;
        }
        
        return line;
      })
      .join('\n');
  }

  private cleanupIncompleteCode(text: string, context: ProjectContext): string {
    const lines = text.split('\n');
    const cleanedLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (trimmed.endsWith(',') || trimmed.endsWith('...') || trimmed === '...') {
        continue;
      }
      
      let fixedLine = line;
      fixedLine = fixedLine.replace(/;{2,}/g, ';');
      
      if (context.projectStyle.semicolons && 
          trimmed && 
          !trimmed.endsWith(';') && 
          !trimmed.endsWith('{') && 
          !trimmed.endsWith('}') &&
          !trimmed.match(/\b(if|for|while|function|class|def)\b/)) {
        fixedLine += ';';
      }
      
      cleanedLines.push(fixedLine);
    }
    
    return cleanedLines.join('\n');
  }

  private buildCacheKey(context: ProjectContext): string {
    const cursor = context.currentFile;
    return `${cursor.file.relativePath}:${cursor.position.line}:${cursor.position.character}:${this.simpleHash(cursor.precedingLines.slice(-200) + cursor.linePrefix)}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash + chr) | 0;
    }
    return hash.toString(36);
  }

  private calculateMaxTokens(context: ProjectContext): number {
    const maxLines = this.config.getValue('maxCompletionLines');
    return Math.min(256, maxLines * 20);
  }

  private getStopSequences(context: ProjectContext): string[] {
    const lang = context.currentFile.file.languageId;
    const indent = context.currentFile.indentation;
    const common = ['\n\n\n']; 

    if (indent.length > 0) {
      const outdent = indent.slice(0, Math.max(0, indent.length - 2));
      common.push(`\n${outdent}class `);
      common.push(`\n${outdent}function `);
    }

    switch (lang) {
      case 'python':
        return [...common, '\nclass ', '\ndef ', '\nasync def ', '\n@'];
      case 'typescript':
      case 'javascript':
      case 'typescriptreact':
      case 'javascriptreact':
        return [...common, '\nexport ', '\ninterface ', '\ntype ', '\nimport '];
      default:
        return common;
    }
  }

  private estimateConfidence(
    completion: string,
    context: ProjectContext
  ): number {
    let confidence = 0.5;

    if (completion.length < 50) confidence += 0.15;
    if (completion.length < 20) confidence += 0.1;
    if (completion.length > 200) confidence -= 0.1;

    if (context.symbols.length > 5) confidence += 0.05;
    if (context.imports.length > 0) confidence += 0.05;
    if (context.resolvedSignatures && context.resolvedSignatures.length > 0) confidence += 0.05;

    return Math.min(1, Math.max(0, confidence));
  }

  private generateId(): string {
    return `pred_${Date.now()}_${this.idCounter++}`;
  }
}
