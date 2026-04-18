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
      let prompt = this.promptBuilder.buildCompletionPrompt(context);

      // Inject Negative Feedback to prevent exact duplicate hallucination!
      const relevantRejections = this.recentRejections.filter(r => 
        Date.now() - r.timestamp < 300000 && // Within last 5 mins
        (!r.file || r.file === context.currentFile.file.relativePath) && 
        (!r.line || Math.abs(r.line - context.currentFile.position.line) <= 2)
      );

      if (relevantRejections.length > 0) {
          const rejectedText = relevantRejections.map(r => r.text).join('\n---\n');
          prompt += `\n\n[NEGATIVE FEEDBACK]:\nThe user explicitly REJECTED the following suggestions here. DO NOT generate these strings again. Try a different approach:\n${rejectedText}\n[END NEGATIVE FEEDBACK]\n\n`;
      }
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
   * Run a complex transformation on the current context.
   * @param context The project context
   * @param intent The user's refactoring intent
   * @param token Optional cancellation token
   * @returns A promise that resolves to a structured action plan
   */
  public async getTransformation(
    context: ProjectContext,
    intent?: string,
    token?: vscode.CancellationToken
  ): Promise<ActionPlan | null> {
    const timer = this.logger.time('PredictionEngine.getTransformation');
    try {
      const prompt = this.promptBuilder.buildTransformationPrompt(context, intent);

      const response = await this.modelLayer.complete({
        prompt,
        maxTokens: 2000,
        temperature: 0.1,
        stream: false,
      }, 'background');

      // Trigger speculative planning for multi-file edits in the background
      this.triggerSpeculativePlanning(context);

      // Parse structured action response
      const plan = this.parseActionPlan(response.text);
      timer();
      return plan;
    } catch (err: any) {
      timer();
      if (err.name === 'AbortError') return null;
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
      }, 'background');

      const predictions = this.parseNextEditPredictions(response.text);
      this.nextEditPredictions = predictions;

      this.eventBus.emit({
          type: 'next_edits_updated',
          data: { predictions }
      } as any);

      timer();
      return predictions;
    } catch (err: any) {
      timer();
      if (err.name === 'AbortError') return [];
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
   * Manually set next-edit predictions (used by AutonomousRefactorEngine).
   */
  public setPredictions(predictions: NextEditPrediction[]): void {
      this.nextEditPredictions = predictions;
      this.eventBus.emit({
          type: 'next_edits_updated',
          data: { predictions }
      } as any);
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
   * Enhanced post-processing with better context awareness
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
    processed = processed.replace(/^[#\s]*TODO:.*$/gm, '');

    // Enhanced duplicate stripping with better context awareness
    const prefix = context.currentFile.linePrefix.trim();
    if (prefix && processed.trim().startsWith(prefix)) {
        // Find the actual prefix in the text to handle whitespace correctly
        const prefixIdx = processed.indexOf(prefix);
        if (prefixIdx !== -1) {
            processed = processed.slice(prefixIdx + prefix.length);
        }
    }

    // Smart truncation based on logical code boundaries
    processed = this.smartTruncate(processed, context);

    // Don't duplicate text that already exists after the cursor
    const suffix = context.currentFile.lineSuffix.trim();
    if (suffix && processed.endsWith(suffix)) {
      processed = processed.slice(0, -suffix.length);
    }

    // Enhanced indentation handling
    processed = this.fixIndentation(processed, context);

    // Remove incomplete or malformed code
    processed = this.cleanupIncompleteCode(processed, context);

    return processed;
  }

  /**
   * Smart truncation at logical code boundaries
   */
  private smartTruncate(text: string, context: ProjectContext): string {
    const maxLines = this.config.getValue('maxCompletionLines');
    const lines = text.split('\n');
    
    if (lines.length <= maxLines) {
      return text;
    }

    // Look for natural break points
    const breakPoints = [
      /^\s*}\s*$/,           // End of class/function
      /^\s*\);\s*$/,         // End of function call
      /^\s*;\s*$/,           // End of statement
      /^\s*$/                 // Empty line
    ];

    for (let i = maxLines - 1; i >= Math.max(0, maxLines - 10); i--) {
      const line = lines[i];
      if (breakPoints.some(pattern => pattern.test(line))) {
        return lines.slice(0, i + 1).join('\n');
      }
    }

    // Fallback to simple truncation
    return lines.slice(0, maxLines).join('\n');
  }

  /**
   * Enhanced indentation fixing
   */
  private fixIndentation(text: string, context: ProjectContext): string {
    const contextIndent = context.currentFile.indentation;
    const lines = text.split('\n');
    
    return lines
      .map((line, i) => {
        if (i === 0) return line; // First line continues from cursor
        if (!line.trim()) return line; // Keep empty lines
        
        // Preserve relative indentation while matching base style
        const leadingWhitespace = line.match(/^[ \t]*/)?.[0] || '';
        const strippedLine = line.substring(leadingWhitespace.length);
        
        // Use project's indentation style
        if (context.projectStyle.indentation === 'spaces') {
          const indentLevel = Math.floor(leadingWhitespace.length / context.projectStyle.indentSize);
          return ' '.repeat(indentLevel * context.projectStyle.indentSize) + strippedLine;
        }
        
        return line; // Keep original for tabs
      })
      .join('\n');
  }

  /**
   * Clean up incomplete or malformed code
   */
  private cleanupIncompleteCode(text: string, context: ProjectContext): string {
    const lines = text.split('\n');
    const cleanedLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Skip obviously incomplete lines
      if (trimmed.endsWith(',') || trimmed.endsWith('...') || trimmed === '...') {
        continue;
      }
      
      // Fix common syntax issues
      let fixedLine = line;
      
      // Fix double semicolons
      fixedLine = fixedLine.replace(/;{2,}/g, ';');
      
      // Fix missing semicolons in certain contexts
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
    return `${cursor.file.relativePath}:${cursor.position.line}:${cursor.position.character}:${this.simpleHash(cursor.precedingLines.slice(-200) + cursor.linePrefix)}`;
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
  private calculateMaxTokens(context: ProjectContext): number {
    const maxLines = this.config.getValue('maxCompletionLines');
    // Drastically cap max tokens to ensure sub-100ms finish times for inline context
    // The shorter the generation limit, the earlier the LLM API finalizes the stream
    return Math.min(256, maxLines * 20);
  }

  /**
   * Get stop sequences based on the current language.
   * Leverages advanced block-outdent detection to halt the LLM instantly.
   * @param context The project context
   * @returns An array of stop sequences
   */
  private getStopSequences(context: ProjectContext): string[] {
    const lang = context.currentFile.file.languageId;
    const indent = context.currentFile.indentation;
    const common = ['\n\n\n']; 

    // Advanced: Prevent deep architectural hallucinations by stopping on outdented structures
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

  /**
   * Enhanced confidence estimation with multiple factors
   * @param completion The generated completion text
   * @param context The project context
   * @returns A confidence value between 0 and 1
   */
  private estimateConfidence(
    completion: string,
    context: ProjectContext
  ): number {
    let confidence = 0.5; // Base confidence

    // Length-based scoring
    if (completion.length < 50) confidence += 0.15;
    if (completion.length < 20) confidence += 0.1;
    if (completion.length > 200) confidence -= 0.1;

    // Context quality scoring
    if (context.symbols.length > 5) confidence += 0.05;
    if (context.imports.length > 0) confidence += 0.05;
    if (context.resolvedSignatures && context.resolvedSignatures.length > 0) confidence += 0.05;

    // Code structure scoring
    const lines = completion.split('\n');
    const hasValidStructure = this.validateCodeStructure(completion, context.currentFile.file.languageId);
    if (hasValidStructure) confidence += 0.1;

    // Language-specific patterns
    if (this.hasLanguageSpecificPatterns(completion, context.currentFile.file.languageId)) {
      confidence += 0.05;
    }

    // Consistency with project style
    if (this.isConsistentWithProjectStyle(completion, context.projectStyle)) {
      confidence += 0.05;
    }

    // Penalty for incomplete code
    if (this.isLikelyIncomplete(completion)) {
      confidence -= 0.1;
    }

    // Bonus for contextually relevant completions
    if (this.isContextuallyRelevant(completion, context)) {
      confidence += 0.1;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  /**
   * Validate basic code structure
   */
  private validateCodeStructure(code: string, languageId: string): boolean {
    const trimmed = code.trim();
    if (!trimmed) return false;

    // Check for balanced brackets
    const brackets: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    
    for (const char of trimmed) {
      if (brackets[char]) {
        stack.push(brackets[char]);
      } else if (Object.values(brackets).includes(char)) {
        if (stack.pop() !== char) return false;
      }
    }
    
    if (stack.length > 0) return false;

    // Language-specific validation
    switch (languageId) {
      case 'typescript':
      case 'javascript':
        return !trimmed.match(/^[^\w]*function[^\w]*$/) && // Not just "function"
               !trimmed.match(/^[^\w]*class[^\w]*$/); // Not just "class"
      case 'python':
        return !trimmed.match(/^[^\w]*def[^\w]*$/) && // Not just "def"
               !trimmed.match(/^[^\w]*class[^\w]*$/); // Not just "class"
      default:
        return true;
    }
  }

  /**
   * Check for language-specific patterns
   */
  private hasLanguageSpecificPatterns(code: string, languageId: string): boolean {
    switch (languageId) {
      case 'typescript':
      case 'javascript':
        return code.includes('function') || 
               code.includes('const ') || 
               code.includes('let ') || 
               code.includes('class ') ||
               code.includes('=>') ||
               code.includes('import ');
      case 'python':
        return code.includes('def ') || 
               code.includes('class ') ||
               code.includes('import ') ||
               code.includes('from ') ||
               code.includes('self.');
      case 'java':
        return code.includes('public ') || 
               code.includes('private ') ||
               code.includes('class ') ||
               code.includes('interface ');
      default:
        return true;
    }
  }

  /**
   * Check consistency with project style
   */
  private isConsistentWithProjectStyle(code: string, style: any): boolean {
    // Check indentation consistency
    const hasSpaces = code.includes('  ');
    const hasTabs = code.includes('\t');
    
    if (style.indentation === 'spaces' && hasTabs) return false;
    if (style.indentation === 'tabs' && hasSpaces) return false;

    // Check quote style
    const singleQuotes = (code.match(/'/g) || []).length;
    const doubleQuotes = (code.match(/"/g) || []).length;
    
    if (style.quoteStyle === 'single' && doubleQuotes > singleQuotes) return false;
    if (style.quoteStyle === 'double' && singleQuotes > doubleQuotes) return false;

    return true;
  }

  /**
   * Check if code is likely incomplete
   */
  private isLikelyIncomplete(code: string): boolean {
    const trimmed = code.trim();
    
    // Ends with incomplete patterns
    if (trimmed.endsWith(',') || 
        trimmed.endsWith('...') || 
        trimmed.endsWith(' +') ||
        trimmed.endsWith(' ||') ||
        trimmed.endsWith(' &&')) {
      return true;
    }

    // Unbalanced brackets (quick check)
    const openBrackets = (trimmed.match(/[\[{]/g) || []).length;
    const closeBrackets = (trimmed.match(/[\]}]/g) || []).length;
    
    return openBrackets !== closeBrackets;
  }

  /**
   * Check if completion is contextually relevant
   */
  private isContextuallyRelevant(completion: string, context: ProjectContext): boolean {
    const completionLower = completion.toLowerCase();
    const prefixLower = context.currentFile.linePrefix.toLowerCase();
    
    // Check if completion relates to recent symbols
    const relevantSymbols = context.symbols.filter(s => 
      prefixLower.includes(s.name.toLowerCase()) ||
      completionLower.includes(s.name.toLowerCase())
    );
    
    return relevantSymbols.length > 0;
  }

  /**
   * Generate a unique ID for events and plans.
   * @returns A unique ID string
   */
  private generateId(): string {
    return `sonec_${Date.now()}_${++this.idCounter}`;
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
          this.logger.debug(`Background speculation ready with ${plan.actions.length} actions`);
          
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
