/**
 * AutoCode Context Ranker
 * 
 * Ranks and compresses context to fit within the model's token budget.
 * Uses a priority-based system to determine what context is most relevant.
 */

import { ProjectContext, FileContext, SymbolInfo, EditEvent } from '../core/types';

interface ContextBudget {
  currentFile: number;      // ~40% of budget
  openFiles: number;        // ~20% of budget
  relatedFiles: number;     // ~15% of budget
  symbols: number;          // ~10% of budget
  gitDiffs: number;         // ~5% of budget
  recentEdits: number;      // ~5% of budget
  style: number;            // ~5% of budget
}

/** Rough chars-per-token estimate for English / code */
const CHARS_PER_TOKEN = 3.5;

export class ContextRanker {
  /**
   * Rank and compress the full project context to fit within token budget.
   * Returns a modified ProjectContext with truncated fields.
   */
  rankAndCompress(
    context: ProjectContext,
    maxTokens: number
  ): ProjectContext {
    const totalChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
    const budget = this.allocateBudget(totalChars);

    return {
      currentFile: this.compressCursorContext(context.currentFile, budget.currentFile),
      openFiles: this.compressFileList(context.openFiles, budget.openFiles),
      relatedFiles: this.compressFileList(context.relatedFiles, budget.relatedFiles),
      symbols: this.compressSymbols(context.symbols, budget.symbols),
      imports: context.imports, // Imports are already compact
      gitDiffs: this.compressGitDiffs(context.gitDiffs, budget.gitDiffs),
      recentEdits: this.compressEdits(context.recentEdits, budget.recentEdits),
      projectStyle: context.projectStyle, // Style metadata is compact
    };
  }

  private allocateBudget(totalChars: number): ContextBudget {
    return {
      currentFile: Math.floor(totalChars * 0.40),
      openFiles: Math.floor(totalChars * 0.20),
      relatedFiles: Math.floor(totalChars * 0.15),
      symbols: Math.floor(totalChars * 0.10),
      gitDiffs: Math.floor(totalChars * 0.05),
      recentEdits: Math.floor(totalChars * 0.05),
      style: Math.floor(totalChars * 0.05),
    };
  }

  private compressCursorContext(
    cursor: ProjectContext['currentFile'],
    charBudget: number
  ): ProjectContext['currentFile'] {
    // Priority: linePrefix + lineSuffix > preceding > following > file content
    const essentialChars =
      cursor.linePrefix.length +
      cursor.lineSuffix.length;

    const remainingBudget = charBudget - essentialChars;
    if (remainingBudget <= 0) {
      return cursor;
    }

    // Split remaining budget 60/40 between preceding and following
    const precedingBudget = Math.floor(remainingBudget * 0.6);
    const followingBudget = remainingBudget - precedingBudget;

    return {
      ...cursor,
      precedingLines: this.truncateFromStart(
        cursor.precedingLines,
        precedingBudget
      ),
      followingLines: cursor.followingLines.substring(0, followingBudget),
      file: {
        ...cursor.file,
        content: '', // Don't duplicate — preceding/following covers the window
      },
    };
  }

  private compressFileList(
    files: FileContext[],
    charBudget: number
  ): FileContext[] {
    if (files.length === 0) {return [];}

    const perFileBudget = Math.floor(charBudget / Math.min(files.length, 5));
    return files.slice(0, 5).map((f) => ({
      ...f,
      content: this.extractRelevantContent(f.content, perFileBudget),
    }));
  }

  private compressSymbols(
    symbols: SymbolInfo[],
    charBudget: number
  ): SymbolInfo[] {
    // Sort by relevance (kind priority: function > class > variable)
    const sorted = [...symbols].sort((a, b) => {
      const kindPriority = this.symbolKindPriority(a.kind) - this.symbolKindPriority(b.kind);
      return kindPriority;
    });

    let totalChars = 0;
    const result: SymbolInfo[] = [];
    for (const sym of sorted) {
      const symChars = sym.name.length + (sym.detail?.length || 0) + 20;
      if (totalChars + symChars > charBudget) {break;}
      result.push(sym);
      totalChars += symChars;
    }
    return result;
  }

  private compressGitDiffs(
    diffs: ProjectContext['gitDiffs'],
    charBudget: number
  ): ProjectContext['gitDiffs'] {
    let totalChars = 0;
    const result = [];
    for (const diff of diffs) {
      const diffChars = diff.hunks.reduce(
        (sum, h) => sum + h.content.length,
        0
      );
      if (totalChars + diffChars > charBudget) {break;}
      result.push(diff);
      totalChars += diffChars;
    }
    return result;
  }

  private compressEdits(
    edits: EditEvent[],
    charBudget: number
  ): EditEvent[] {
    // Most recent edits first
    const sorted = [...edits].sort((a, b) => b.timestamp - a.timestamp);
    let totalChars = 0;
    const result: EditEvent[] = [];
    for (const edit of sorted) {
      const editChars = edit.newText.length + edit.file.length + 30;
      if (totalChars + editChars > charBudget) {break;}
      result.push(edit);
      totalChars += editChars;
    }
    return result;
  }

  /**
   * Extract the most relevant parts of file content within char budget.
   * Prioritizes: imports/exports, type definitions, function signatures.
   */
  private extractRelevantContent(content: string, charBudget: number): string {
    if (content.length <= charBudget) {
      return content;
    }

    const lines = content.split('\n');
    const sections: { priority: number; content: string }[] = [];

    // Classify each line/block by importance
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      let priority = 3; // default: medium-low
      if (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('export ') ||
        trimmed.startsWith('from ') ||
        trimmed.startsWith('require(')
      ) {
        priority = 0; // highest
      } else if (
        trimmed.startsWith('interface ') ||
        trimmed.startsWith('type ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('enum ')
      ) {
        priority = 1;
      } else if (
        trimmed.startsWith('function ') ||
        trimmed.startsWith('const ') ||
        trimmed.startsWith('export function') ||
        trimmed.match(/^(async\s+)?function/)
      ) {
        priority = 2;
      }

      sections.push({ priority, content: line });
    }

    // Sort by priority, take lines until budget filled
    sections.sort((a, b) => a.priority - b.priority);
    let chars = 0;
    const selected: string[] = [];
    for (const section of sections) {
      if (chars + section.content.length + 1 > charBudget) {break;}
      selected.push(section.content);
      chars += section.content.length + 1;
    }

    return selected.join('\n');
  }

  /** Truncate string from the start, keeping the end */
  private truncateFromStart(text: string, maxChars: number): string {
    if (text.length <= maxChars) {return text;}
    return text.substring(text.length - maxChars);
  }

  private symbolKindPriority(kind: number): number {
    // Lower = higher priority
    const priorities: Record<number, number> = {
      5: 0,   // Function
      4: 1,   // Class
      10: 2,  // Interface
      13: 3,  // Variable
      11: 4,  // Module
      9: 5,   // Enum
    };
    return priorities[kind] ?? 10;
  }
}
