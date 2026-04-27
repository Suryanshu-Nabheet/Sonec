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
    
    // 1. Advanced Cache Lookup
    const cacheKey = `${document.uri.toString()}:${position.line}:${linePrefix}`;
    const contextHash = this.cache.generateHash(context.currentFile.precedingLines);
    const cached = await this.cache.get(cacheKey, contextHash);
    
    if (cached) {
      this.logger.debug(`Cache hit for completion at L${position.line}`);
      this.eventBus.emit({ type: 'cache_hit', data: { key: cacheKey } });
      return cached;
    }

    // 2. Prompt Construction
    const prompt = this.promptBuilder.buildCompletionPrompt(context);
    
    // 3. Model Inference
    const request: ModelRequest = {
      prompt,
      maxTokens: this.config.getValue('maxCompletionLines') * 50,
      temperature: 0.2,
      stopSequences: ['\n\n', '<|fim_suffix|>', '```'],
      stream: this.config.getValue('streamingEnabled'),
    };

    try {
      this.eventBus.emit({ 
        type: 'completion_triggered', 
        data: { file: document.fileName, position } 
      });

      const response = await this.modelLayer.complete(request);
      if (token.isCancellationRequested) {return null;}

      // 4. Post-processing
      const completionText = this.postProcess(response.text);
      if (!completionText) return null;

      const result: CompletionResult = {
        id: Math.random().toString(36).substring(7),
        text: completionText,
        insertText: completionText,
        range: new vscode.Range(position, position),
        confidence: 0.9, // Simplified
        source: 'inline',
        metadata: {
          modelLatencyMs: response.latencyMs,
          contextTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          cached: false,
        },
      };

      // 5. Update Cache
      this.cache.set(cacheKey, result, contextHash);

      return result;
    } catch (err) {
      this.logger.error('Completion generation failed', err);
      return null;
    }
  }

  private postProcess(text: string): string {
    let processed = text.trimEnd();
    
    // Remove model artifacts
    processed = processed.replace(/<\|fim_middle\|>/g, '');
    processed = processed.replace(/<\|fim_suffix\|>/g, '');
    processed = processed.replace(/^[#\s]*TODO:.*$/gm, '');
    
    return processed;
  }

  dispose(): void {
    this.streamingRequests.forEach((cts) => cts.cancel());
    this.disposables.forEach((d) => d.dispose());
  }
}
