/**
 * AutoCode Inline Completion Provider
 * 
 * The VS Code integration point that provides inline completions.
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
 * Provides inline completions for the AutoCode extension.
 */
export class AutoCodeCompletionProvider
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
   */
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (!this.config.isReady()) {
      return null;
    }

    if (this.isExcludedLanguage(document.languageId)) {
      return null;
    }

    // Continuous Typing Fast-Forward
    if (this.lastPosition && this.currentCompletion) {
        if (position.line === this.lastPosition.line && position.character > this.lastPosition.character) {
            const lineText = document.lineAt(position.line).text;
            const typedText = lineText.substring(this.lastPosition.character, position.character);
            const remaining = this.currentCompletion.insertText.substring(this.acceptedOffset);
            
            if (remaining.startsWith(typedText)) {
                this.acceptedOffset += typedText.length;
                this.lastPosition = position;
                
                const newRemaining = remaining.substring(typedText.length);
                if (newRemaining.length > 0) {
                    return [new vscode.InlineCompletionItem(
                        newRemaining,
                        new vscode.Range(position, position)
                    )];
                }
            }
            // If it doesn't match, we clear and fall through to fetch new completion
            this.currentCompletion = null;
            this.acceptedOffset = 0;
        } else if (position.line !== this.lastPosition.line || position.character < this.lastPosition.character) {
            this.currentCompletion = null;
            this.acceptedOffset = 0;
        }
    }

    this.lastPosition = position;

    try {
      this.eventBus.emit({
        type: 'completion_triggered',
        data: {
          file: document.uri.fsPath,
          position,
        },
      });

      // Check for prefetched results
      const prefetchKey = `${document.uri.fsPath}:${position.line}:${position.character}`;
      if (this.prefetchResult && this.prefetchResult.key === prefetchKey) {
        this.logger.debug('Using prefetched completion');
        return [this.createInlineItem(this.prefetchResult.result, position, document)];
      }

      const projectContext = await this.contextEngine.buildContext(
        document,
        position,
        token
      );

      if (token.isCancellationRequested) {
        return null;
      }

      const startTime = Date.now();
      let completion = await this.predictionEngine.getCompletion(
        document,
        position,
        projectContext,
        token
      );

      if (!completion || token.isCancellationRequested) {
        return null;
      }

      const latency = Date.now() - startTime;
      this.perfMonitor.recordLatency('completion', latency);

      this.currentCompletion = completion;
      this.acceptedOffset = 0;

      const item = this.createInlineItem(completion, position, document);

      this.eventBus.emit({
        type: 'completion_shown',
        data: {
          id: completion.id,
          confidence: completion.confidence,
        },
      });

      if (this.config.getValue('prefetchEnabled')) {
        this.schedulePrefetch(document, position);
      }

      return [item];
    } catch (err: any) {
      if (err.name === 'AbortError') {
          return null;
      }
      this.logger.error('Completion provider failed', err);
      return null;
    }
  }

  private createInlineItem(
    completion: CompletionResult,
    position: vscode.Position,
    document: vscode.TextDocument
  ): vscode.InlineCompletionItem {
    let range = new vscode.Range(position, position);

    if (completion.range) {
       range = completion.range;
    } else {
      const lineText = document.lineAt(position.line).text;
      if (lineText.trim().length < 5 || position.character === 0) {
        range = new vscode.Range(position, document.lineAt(position.line).range.end);
      }
    }

    const item = new vscode.InlineCompletionItem(completion.insertText, range);
    
    item.command = {
        title: 'Post-Acceptance Hook',
        command: 'autocode.onCompletionAccepted',
        arguments: [completion]
    };

    return item;
  }

  async acceptWord(): Promise<boolean> {
    if (!this.currentCompletion) {return false;}

    const remaining = this.currentCompletion.insertText.substring(
      this.acceptedOffset
    );
    if (!remaining) {return false;}

    const wordMatch = remaining.match(/^\s*\S+/);
    if (!wordMatch) {return false;}

    const wordText = wordMatch[0];
    this.acceptedOffset += wordText.length;

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

  async acceptLine(): Promise<boolean> {
    if (!this.currentCompletion) {return false;}

    const remaining = this.currentCompletion.insertText.substring(
      this.acceptedOffset
    );
    if (!remaining) {return false;}

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

  dismiss(): void {
    if (this.currentCompletion) {
      this.perfMonitor.recordDismissed();

      this.eventBus.emit({
        type: 'completion_dismissed',
        data: {
          id: this.currentCompletion.id,
          reason: 'user_dismissed',
          text: this.currentCompletion.insertText,
          line: this.lastPosition?.line,
        },
      });
    }

    this.currentCompletion = null;
    this.acceptedOffset = 0;
  }

  private schedulePrefetch(
    document: vscode.TextDocument,
    currentPosition: vscode.Position
  ): void {
    if (!this.currentCompletion) {return;}

    const insertText = this.currentCompletion.insertText;
    const lines = insertText.split('\n');
    const endLine = currentPosition.line + lines.length - 1;
    const endChar =
      lines.length === 1
        ? currentPosition.character + insertText.length
        : lines[lines.length - 1].length;

    const nextPosition = new vscode.Position(endLine, endChar);

    setTimeout(async () => {
      try {
        const cts = new vscode.CancellationTokenSource();
        setTimeout(() => cts.cancel(), 5000);

        const context = await this.contextEngine.buildContext(
          document,
          nextPosition,
          cts.token
        );

        const result = await this.predictionEngine.getCompletion(
          document,
          nextPosition,
          context,
          cts.token
        );

        if (result) {
          const key = `${document.uri.fsPath}:${nextPosition.line}:${nextPosition.character}`;
          this.prefetchResult = { key, result };
        }

        cts.dispose();
      } catch {
        // Prefetch failures are non-critical
      }
    }, 5);
  }

  private isExcludedLanguage(langId: string): boolean {
    const excluded = [
      'log',
      'output',
      'binary',
      'search-result',
      'scm-input',
    ];
    return excluded.includes(langId);
  }
}
