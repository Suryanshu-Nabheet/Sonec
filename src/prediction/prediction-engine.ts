/**
 * SONEC Prediction Engine
 * 
 * Core intelligence that transforms context into code completions
 * and structured edit actions. Orchestrates between the context engine,
 * model layer, and cache to produce high-quality, low-latency predictions.
 */

import * as vscode from 'vscode';
import {
  CompletionResult,
  ProjectContext,
  ActionPlan,
  StructuredAction,
  NextEditPrediction,
  PredictedEdit,
} from '../core/types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { ModelLayer } from '../models/model-layer';
import { PromptBuilder } from '../models/prompt-builder';
import { CompletionCache } from '../cache/completion-cache';

/**
 * Manages the generation and processing of code predictions and transformations.
 */
export class PredictionEngine implements vscode.Disposable {
  private config: ConfigManager;
  private logger: Logger;
  private eventBus: EventBus;
  private modelLayer: ModelLayer;
  private promptBuilder: PromptBuilder;
  private cache: CompletionCache;
  private pendingPredictions: Map<string, PredictedEdit[]> = new Map();
  private nextEditPredictions: NextEditPrediction[] = [];
  private speculativePlan: ActionPlan | null = null;
  private idCounter = 0;

  constructor(modelLayer: ModelLayer) {
    this.config = ConfigManager.getInstance();
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
    this.modelLayer = modelLayer;
    this.promptBuilder = new PromptBuilder();
    this.cache = new CompletionCache();
  }

  /**
   * Generate inline completion for the current cursor position.
   * This is the hot path — optimized for minimum latency.
   * @param context The current project context
   * @param token The cancellation token
   * @returns A promise that resolves to a completion result or null
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
      const prompt = this.promptBuilder.buildCompletionPrompt(context);

      // Call model
      const startTime = Date.now();
      let completionText = '';

      if (this.config.getValue('streamingEnabled')) {
        // Stream for lower perceived latency
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
    } catch (err) {
      timer();
      if (err instanceof Error && err.message.includes('cancelled')) {
        return null;
      }
      this.logger.error('Completion failed', err);
      return null;
    }
  }

  /**
   * Generate a structured transformation plan (multi-file edits).
   * @param context The project context
   * @param userIntent Optional explicit user intent
   * @param token Optional cancellation token
   * @returns A promise that resolves to an action plan or null
   */
  async getTransformation(
    context: ProjectContext,
    userIntent?: string,
    token?: vscode.CancellationToken
  ): Promise<ActionPlan | null> {
    const timer = this.logger.time('PredictionEngine.getTransformation');

    try {
      const prompt = this.promptBuilder.buildTransformationPrompt(
        context,
        userIntent
      );

      const response = await this.modelLayer.complete({
        prompt,
        maxTokens: 2000,
        temperature: 0.2,
        stream: false,
      });

      // Trigger speculative planning for multi-file edits in the background
      this.triggerSpeculativePlanning(context);

      // Parse structured action response
      const plan = this.parseActionPlan(response.text);
      timer();
      return plan;
    } catch (err) {
      timer();
      this.logger.error('Transformation failed', err);
      return null;
    }
  }

  /**
   * Predict the next edit locations based on recent context.
   * @param context The project context
   * @param token Optional cancellation token
   * @returns A promise that resolves to an array of next-edit predictions
   */
  async predictNextEdits(
    context: ProjectContext,
    token?: vscode.CancellationToken
  ): Promise<NextEditPrediction[]> {
    const timer = this.logger.time('PredictionEngine.predictNextEdits');

    try {
      const prompt = this.promptBuilder.buildNextEditPrompt(context);

      const response = await this.modelLayer.complete({
        prompt,
        maxTokens: 1000,
        temperature: 0.3,
        stream: false,
      });

      const predictions = this.parseNextEditPredictions(response.text);
      this.nextEditPredictions = predictions;

      timer();
      return predictions;
    } catch (err) {
      timer();
      this.logger.error('Next-edit prediction failed', err);
      return [];
    }
  }

  /**
   * Get buffered next-edit predictions and find the best jump target.
   * @returns The best jump target or null
   */
  public getJumpTarget(): { file: string; position: vscode.Position } | null {
    if (this.nextEditPredictions.length === 0) return null;
    // Return the highest confidence prediction
    const best = [...this.nextEditPredictions].sort((a, b) => b.confidence - a.confidence)[0];
    return { file: best.file, position: best.position };
  }

  /**
   * Get all currently stored next-edit predictions.
   */
  public getNextEditPredictions(): NextEditPrediction[] {
      return this.nextEditPredictions;
  }

  /**
   * Get pending predicted edits for a file.
   * @param filePath The absolute path to the file
   * @returns An array of predicted edits
   */
  getPendingEdits(filePath: string): PredictedEdit[] {
    return this.pendingPredictions.get(filePath) || [];
  }

  /**
   * Post-process raw model output into clean completion text.
   * @param text The raw text from the model
   * @param context The project context
   * @returns The processed completion text
   */
  private postProcess(text: string, context: ProjectContext): string {
    let processed = text;

    // Remove markdown code block markers
    processed = processed.replace(/^```\w*\n?/gm, '');
    processed = processed.replace(/\n?```$/gm, '');

    // Remove common model artifacts
    processed = processed.replace(/^<\/?code>/gm, '');

    // Aggressive duplicate stripping
    // If the model suggests code that includes the text already in the prefix, strip it
    const prefix = context.currentFile.linePrefix.trim();
    if (prefix && processed.trim().startsWith(prefix)) {
        // Find the actual prefix in the text to handle whitespace correctly
        const prefixIdx = processed.indexOf(prefix);
        if (prefixIdx !== -1) {
            processed = processed.slice(prefixIdx + prefix.length);
        }
    }

    // Trim excessive trailing whitespace but preserve intentional newlines
    processed = processed.replace(/\n{3,}/g, '\n\n');

    // Don't duplicate text that already exists after the cursor
    const suffix = context.currentFile.lineSuffix.trim();
    if (suffix && processed.endsWith(suffix)) {
      processed = processed.slice(0, -suffix.length);
    }

    // Ensure indentation matches context
    const contextIndent = context.currentFile.indentation;
    if (contextIndent && processed.startsWith('\n')) {
      const lines = processed.split('\n');
      processed = lines
        .map((line, i) => {
          if (i === 0) {return line;} // First line continues from cursor
          if (!line.trim()) {return line;}
          return line; // Respect model's indentation (it has style context)
        })
        .join('\n');
    }

    // Enforce max completion lines
    const maxLines = this.config.getValue('maxCompletionLines');
    const lines = processed.split('\n');
    if (lines.length > maxLines) {
      // Try to find a natural break point
      const breakIdx = this.findNaturalBreak(lines, maxLines);
      processed = lines.slice(0, breakIdx).join('\n');
    }

    return processed;
  }

  /**
   * Find a natural code break point (end of function, class, etc.).
   * @param lines The lines of code
   * @param maxLine The maximum allowed line index
   * @returns The index of the natural break point
   */
  private findNaturalBreak(lines: string[], maxLine: number): number {
    // Look backwards from maxLine for a closing brace or empty line
    for (let i = maxLine; i > maxLine - 10 && i > 0; i--) {
      const trimmed = lines[i]?.trim();
      if (
        trimmed === '}' ||
        trimmed === '};' ||
        trimmed === ')' ||
        trimmed === '' ||
        trimmed === 'end'
      ) {
        return i + 1;
      }
    }
    return maxLine;
  }

  /**
   * Parse model response into a structured ActionPlan.
   * @param text The raw text from the model
   * @returns The parsed action plan or null
   */
  private parseActionPlan(text: string): ActionPlan | null {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {return null;}

      const parsed = JSON.parse(jsonMatch[0]);

      if (!parsed.actions || !Array.isArray(parsed.actions)) {
        return null;
      }

      const actions: StructuredAction[] = parsed.actions
        .map((a: any) => this.validateAction(a))
        .filter(Boolean);

      if (actions.length === 0) {return null;}

      return {
        id: this.generateId(),
        timestamp: Date.now(),
        actions,
        reasoning: parsed.reasoning,
        totalConfidence:
          actions.reduce((sum, a) => sum + a.confidence, 0) / actions.length,
      };
    } catch (err) {
      this.logger.error('Failed to parse action plan', err);
      return null;
    }
  }

  /**
   * Validate a single action from model output.
   * @param raw The raw action object
   * @returns The validated structured action or null
   */
  private validateAction(raw: any): StructuredAction | null {
    if (!raw.type || !raw.file) {return null;}

    const confidence = Math.min(1, Math.max(0, raw.confidence || 0.5));

    switch (raw.type) {
      case 'insert':
        if (!raw.position || raw.code === undefined) {return null;}
        return {
          type: 'insert',
          file: raw.file,
          position: {
            line: raw.position.line || 0,
            character: raw.position.character || 0,
          },
          code: raw.code,
          confidence,
          description: raw.description,
        };

      case 'replace':
        if (!raw.range || raw.code === undefined) {return null;}
        return {
          type: 'replace',
          file: raw.file,
          range: {
            startLine: raw.range.startLine || 0,
            startCharacter: raw.range.startCharacter || 0,
            endLine: raw.range.endLine || 0,
            endCharacter: raw.range.endCharacter || 0,
          },
          code: raw.code,
          confidence,
          description: raw.description,
        };

      case 'delete':
        if (!raw.range) {return null;}
        return {
          type: 'delete',
          file: raw.file,
          range: {
            startLine: raw.range.startLine || 0,
            startCharacter: raw.range.startCharacter || 0,
            endLine: raw.range.endLine || 0,
            endCharacter: raw.range.endCharacter || 0,
          },
          confidence,
          description: raw.description,
        };

      default:
        return null;
    }
  }

  /**
   * Parse next-edit predictions from model output.
   * @param text The raw text from the model
   * @returns An array of next-edit predictions
   */
  private parseNextEditPredictions(text: string): NextEditPrediction[] {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {return [];}

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.predictions || !Array.isArray(parsed.predictions)) {
        return [];
      }

      return parsed.predictions
        .filter((p: any) => p.file && typeof p.line === 'number')
        .map((p: any) => ({
          file: p.file,
          position: new vscode.Position(p.line, 0),
          reason: p.reason || '',
          confidence: Math.min(1, Math.max(0, p.confidence || 0.5)),
          suggestedAction: p.suggestedChange
            ? {
                type: 'insert' as const,
                file: p.file,
                position: { line: p.line, character: 0 },
                code: p.suggestedChange,
                confidence: p.confidence || 0.5,
              }
            : undefined,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Build a unique cache key for the current context.
   * @param context The project context
   * @returns The cache key string
   */
  private buildCacheKey(context: ProjectContext): string {
    const cursor = context.currentFile;
    // Use file path + position + preceding text hash as cache key
    return `\${cursor.file.relativePath}:\${cursor.position.line}:\${cursor.position.character}:\${this.simpleHash(cursor.precedingLines.slice(-200) + cursor.linePrefix)}`;
  }

  /**
   * Simple string hashing function.
   * @param str The string to hash
   * @returns The hash string
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash + chr) | 0;
    }
    return hash.toString(36);
  }

  /**
   * Calculate the maximum tokens allowed for the completion response.
   * @param _context The project context
   * @returns The maximum token count
   */
  private calculateMaxTokens(_context: ProjectContext): number {
    const maxLines = this.config.getValue('maxCompletionLines');
    // Estimate ~20 tokens per line of code
    return Math.min(2000, maxLines * 20);
  }

  /**
   * Get stop sequences based on the current language.
   * @param context The project context
   * @returns An array of stop sequences
   */
  private getStopSequences(context: ProjectContext): string[] {
    const lang = context.currentFile.file.languageId;
    const common = ['\n\n\n']; // Triple newline = likely end of block

    switch (lang) {
      case 'python':
        return [...common, '\nclass ', '\ndef ', '\nasync def '];
      case 'typescript':
      case 'javascript':
      case 'typescriptreact':
      case 'javascriptreact':
        return [...common];
      default:
        return common;
    }
  }

  /**
   * Estimate the confidence of a generated completion.
   * @param completion The generated completion text
   * @param context The project context
   * @returns A confidence value between 0 and 1
   */
  private estimateConfidence(
    completion: string,
    context: ProjectContext
  ): number {
    let confidence = 0.7; // Base confidence

    // Short completions are generally more reliable
    if (completion.length < 100) {confidence += 0.1;}
    if (completion.length < 30) {confidence += 0.1;}

    // Completions with informed imports context are more reliable
    if (context.imports.length > 0) {confidence += 0.05;}

    // Multi-line completions are less certain
    const lineCount = completion.split('\n').length;
    if (lineCount > 10) {confidence -= 0.1;}
    if (lineCount > 20) {confidence -= 0.1;}

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Generate a unique ID for events and plans.
   * @returns A unique ID string
   */
  private generateId(): string {
    return `sonec_\${Date.now()}_\${++this.idCounter}`;
  }

  /**
   * Pre-calculate multi-file edits in the background.
   * @param context The project context
   */
  private async triggerSpeculativePlanning(context: ProjectContext): Promise<void> {
    const CTS = new vscode.CancellationTokenSource();
    
    // Background speculation should not block or use too many resources
    setTimeout(async () => {
      try {
        const prompt = this.promptBuilder.buildTransformationPrompt(context);
        const response = await this.modelLayer.complete({
          prompt,
          maxTokens: 1500,
          temperature: 0.2,
          stream: false
        });
        
        const plan = this.parseActionPlan(response.text);
        if (plan && plan.actions.length > 0) {
          this.speculativePlan = plan;
          this.logger.debug(`Background speculation ready with \${plan.actions.length} actions`);
          
          // Show non-intrusive status to let user know transformation is ready
          vscode.commands.executeCommand('setContext', 'sonec.transformationReady', true);
        }
      } catch {
        // Silently fail for speculation
      } finally {
        CTS.dispose();
      }
    }, 500);
  }

  /**
   * Get the current speculative action plan.
   * @returns The speculative plan or null
   */
  public getSpeculativePlan(): ActionPlan | null {
    return this.speculativePlan;
  }

  /**
   * Disposes the prediction engine resources.
   */
  dispose(): void {
    this.cache.dispose();
    this.pendingPredictions.clear();
    this.nextEditPredictions = [];
  }
}
