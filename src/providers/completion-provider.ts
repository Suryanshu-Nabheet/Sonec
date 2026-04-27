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

    // Continuous Typing Fast-Forward (Zero-Latency Predictive Ghost Text)
    if (this.lastPosition && this.currentCompletion) {
        if (position.line === this.lastPosition.line && position.character > this.lastPosition.character) {
            const lineText = document.lineAt(position.line).text;
            const typedText = lineText.substring(this.lastPosition.character, position.character);
            const remaining = this.currentCompletion.insertText.substring(this.acceptedOffset);
            
            if (remaining.startsWith(typedText)) {
                this.acceptedOffset += typedText.length;
                this.lastPosition = position;
                
                // Return immediately - perfectly seamless 0ms latency typing!
                return [new vscode.InlineCompletionItem(
                    remaining.substring(typedText.length),
                    new vscode.Range(position, position)
                )];
            } else {
                // User diverged from prediction
                this.currentCompletion = null;
                this.acceptedOffset = 0;
            }
        } else if (position.line !== this.lastPosition.line || position.character < this.lastPosition.character) {
            // Cursor moved somewhere else
            this.currentCompletion = null;
            this.acceptedOffset = 0;
        }
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

      // 1. Zero-latency injection: Check for jump-target matches
      const predictions = this.predictionEngine.getNextEditPredictions();
      const lastTarget = this.predictionEngine.getLastJumpTarget();
      const allCandidates = lastTarget ? [...predictions, lastTarget] : predictions;

      const matchingPrediction = allCandidates.find(p =>
        this.isFileMatch(document.uri, p.file) && p.position.line === position.line
      );

      if (matchingPrediction?.suggestedAction) {
        const action = matchingPrediction.suggestedAction;
        const lineText = document.lineAt(position.line).text;
        const lineEnd = document.lineAt(position.line).range.end;

        let insertText = '';
        let replaceRange = new vscode.Range(position, position);

        if (action.type === 'delete') {
          replaceRange = new vscode.Range(
            new vscode.Position(position.line, 0),
            lineEnd
          );
          insertText = '';
        } else if (action.type === 'replace' && 'code' in action) {
          replaceRange = new vscode.Range(
            new vscode.Position(position.line, 0),
            lineEnd
          );
          insertText = (action as any).code || '';
        } else if (action.type === 'insert' && 'code' in action) {
          replaceRange = new vscode.Range(position, position);
          insertText = (action as any).code || '';
        }

        if (insertText !== lineText || action.type === 'delete') {
          this.logger.debug(`Injecting predicted ${action.type} as instant completion`);

          const item = new vscode.InlineCompletionItem(insertText, replaceRange);
          item.command = {
            title: 'Post-Acceptance Hook',
            command: 'sonec.onCompletionAccepted',
            arguments: [{
              id: `pred-${Date.now()}`,
              text: insertText,
              insertText: insertText,
              range: replaceRange,
              confidence: matchingPrediction.confidence,
              source: 'block',
              metadata: { modelLatencyMs: 0, contextTokens: 0, completionTokens: 0, cached: true }
            }]
          };
          return [item];
        }
      }

      // ── CRITICAL GATE ──
      // When jump predictions exist but we're NOT on the target line,
      // suppress normal completions so TAB is reserved for jumping.
      if (predictions.length > 0) {
        const isOnAnyTarget = predictions.some(p =>
          this.isFileMatch(document.uri, p.file) && p.position.line === position.line
        );
        if (!isOnAnyTarget) {
          // Don't generate normal completions — let TAB trigger jump instead
          return null;
        }
      }

      // 2. Latency reduction: Check for prefetched results
      const prefetchKey = `${document.uri.fsPath}:${position.line}:${position.character}`;
      if (this.prefetchResult && this.prefetchResult.key === prefetchKey) {
        this.logger.debug('Using prefetched completion');
        return [this.createInlineItem(this.prefetchResult.result, position, document)];
      }

      // 3. Build deep context
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

      // Enforce zero tolerance for naive legacy regex fallbacks; 
      // if LLM halts or is cancelled, we cleanly return null to give VSCode control natively.
      if (!completion || token.isCancellationRequested) {
        this.logger.debug('No valid neural completion generated or cancellation requested');
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
        title: 'Post-Acceptance Hook',
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
          text: this.currentCompletion.insertText,
          line: this.lastPosition?.line,
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

    // Delay prefetch to avoid interfering with current completion (minimized)
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
    }, 5);
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

  /**
   * Check if a document URI matches a prediction file path by comparing basenames.
   */
  private isFileMatch(docUri: vscode.Uri, predFile: string): boolean {
    const docName = docUri.fsPath.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
    const predName = predFile.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
    return docName === predName;
  }
}
