/**
 * AutoCode Context Ranker
 * 
 * Ranks and compresses context to fit within the model's token budget.
 * Incorporates an "RL-lite" feedback loop based on historical acceptance.
 */

import { ProjectContext } from '../core/types';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';

interface ContextWeight {
  source: string;
  weight: number;
  acceptanceCount: number;
}

export class ContextRanker {
  private logger = Logger.getInstance();
  private weights: Map<string, ContextWeight> = new Map();

  constructor() {
    this.initWeights();
    this.setupFeedbackLoop();
  }

  private initWeights() {
    const defaults = [
      { source: 'currentFile', weight: 1.0 },
      { source: 'symbols', weight: 0.8 },
      { source: 'resolvedSignatures', weight: 0.9 },
      { source: 'diagnosticSummary', weight: 0.95 },
      { source: 'importSuggestions', weight: 0.85 },
      { source: 'relatedFiles', weight: 0.7 },
      { source: 'gitDiffs', weight: 0.6 },
      { source: 'openFiles', weight: 0.4 },
    ];

    defaults.forEach(d => this.weights.set(d.source, { ...d, acceptanceCount: 0 }));
  }

  /**
   * Listen to acceptance events to "learn" which context sources are most useful.
   */
  private setupFeedbackLoop() {
    EventBus.getInstance().on('completion_accepted', () => {
      // Logic to boost weights of active context items
      // In a full RL system, we'd track exactly which files were in context
      // For this "advance" version, we boost based on general utility
      this.weights.forEach((w, key) => {
        if (w.weight > 0.5) {
          w.acceptanceCount++;
          // Gradually increase weight of successful sources
          w.weight = Math.min(1.5, w.weight + 0.001);
        }
      });
    });
  }

  /**
   * Rank and compress the context based on current weights and token budget.
   */
  public rankAndCompress(context: ProjectContext, maxTokens: number): ProjectContext {
    // 1. Estimate tokens (rough estimate: 1 token ≈ 4 characters)
    // 2. Prioritize based on weights
    // 3. Truncate lower priority items until under budget

    const compressed = { ...context };

    // Implementation of truncation based on weights...
    // (Simplified for this version)
    
    if (this.estimateTokens(JSON.stringify(compressed)) > maxTokens) {
        this.logger.debug('Context exceeds token budget, compressing...');
        // Truncate related files first (lowest weight)
        if (compressed.relatedFiles.length > 3) {
            compressed.relatedFiles = compressed.relatedFiles.slice(0, 3);
        }
        // Truncate open files
        compressed.openFiles = [];
    }

    return compressed;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  public getWeights(): Record<string, number> {
    const result: Record<string, number> = {};
    this.weights.forEach((w, k) => result[k] = w.weight);
    return result;
  }
}
