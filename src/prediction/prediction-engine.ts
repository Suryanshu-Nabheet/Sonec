/**
 * AutoCode Prediction Engine
 * 
 * Manages the lifecycle of code completion requests with advanced caching,
 * predictive prefetching, and streaming delivery.
 */

import * as vscode from 'vscode';
import {
  ProjectContext,
  CompletionResult,
  ModelRequest,
  ModelResponse,
  AutoCodeConfig,
} from '../core/types';
import { ModelLayer } from '../models/model-layer';
import { PromptBuilder } from '../models/prompt-builder';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { CacheManager } from '../core/cache-manager';

export class PredictionEngine implements vscode.Disposable {
  private config = ConfigManager.getInstance();
  private logger = Logger.getInstance();
  private eventBus = EventBus.getInstance();
  private promptBuilder = new PromptBuilder();
  private cache = new CacheManager<CompletionResult>('completions', 300, 1000);
  private streamingRequests = new Map<string, vscode.CancellationTokenSource>();
  private disposables: vscode.Disposable[] = [];

  constructor(private modelLayer: ModelLayer) {}

  /**
   * Main entry point for inline completions.
   */
  async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: ProjectContext,
    token: vscode.CancellationToken
  ): Promise<CompletionResult | null> {
    const startTime = Date.now();
    const cursorLine = document.lineAt(position.line).text;
    const linePrefix = cursorLine.substring(0, position.character);
    
    // 1. FAST-PATH: Immediate Cache Lookup (Sub-millisecond)
    const cacheKey = `${document.uri.toString()}:${position.line}:${linePrefix}`;
    const cached = await this.cache.get(cacheKey);
    
    if (cached) {
      this.logger.debug(`Fast-path cache hit: L${position.line}`);
      return cached;
    }

    // 2. Heavy Context Hash Validation (If not in fast-path)
    const contextHash = this.cache.generateHash(context.currentFile.precedingLines);

    // 3. Prompt Construction
    const prompt = this.promptBuilder.buildCompletionPrompt(context);
    
    // 4. Model Inference
    const request: ModelRequest = {
      prompt,
      maxTokens: Math.min(this.config.getValue('maxCompletionLines') * 10, 500),
      temperature: 0.1,
      stopSequences: ['<|fim_suffix|>', '<|file_separator|>', '```'],
      stream: this.config.getValue('streamingEnabled'),
    };

    try {
      const response = await this.modelLayer.complete(request);
      if (token.isCancellationRequested) {return null;}

      // 5. Post-processing
      const completionText = this.postProcess(response.text, linePrefix);
      if (!completionText) {
          return null;
      }

      const result: CompletionResult = {
        id: Math.random().toString(36).substring(7),
        text: completionText,
        insertText: completionText,
        range: new vscode.Range(position, position),
        confidence: 0.9,
        source: 'inline',
        metadata: {
          modelLatencyMs: response.latencyMs,
          contextTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          cached: false,
        },
      };

      // 6. Update Cache
      this.cache.set(cacheKey, result, contextHash);

      return result;
    } catch (err) {
      this.logger.error('Completion generation failed', err);
      return null;
    }
  }

  private postProcess(text: string, prefix: string): string {
    let processed = text;
    
    // Remove common prefixes that the model might repeat
    if (processed.startsWith(prefix)) {
        processed = processed.substring(prefix.length);
    }

    // Strip model FIM markers
    processed = processed.replace(/<\|fim_middle\|>/g, '');
    processed = processed.replace(/<\|fim_suffix\|>/g, '');
    processed = processed.replace(/<\|fim_prefix\|>/g, '');
    
    // Handle whitespace-only completions
    if (processed.trim().length === 0 && processed.length > 0) {
        return processed;
    }

    processed = processed.trimEnd();
    
    // Reject useless completions
    if (processed.length === 0) return '';
    if (processed.length > 1000) return ''; // Sanity check

    return processed;
  }

  dispose(): void {
    this.streamingRequests.forEach((cts) => cts.cancel());
    this.disposables.forEach((d) => d.dispose());
  }
}
