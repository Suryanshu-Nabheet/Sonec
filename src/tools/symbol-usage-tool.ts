/**
 * AutoCode Symbol Usage Tool
 * 
 * Finds cross-file references to symbols to provide "real-world" usage
 * examples to the AI, improving accuracy for unfamiliar APIs.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

export interface SymbolUsage {
  symbolName: string;
  context: string;
  filePath: string;
  line: number;
}

export class SymbolUsageTool {
  private static instance: SymbolUsageTool;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): SymbolUsageTool {
    if (!SymbolUsageTool.instance) {
      SymbolUsageTool.instance = new SymbolUsageTool();
    }
    return SymbolUsageTool.instance;
  }

  /**
   * Finds references to a symbol at a given position.
   */
  public async findUsages(document: vscode.TextDocument, position: vscode.Position): Promise<SymbolUsage[]> {
    try {
      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        position
      );

      if (!references || references.length <= 1) return [];

      const wordRange = document.getWordRangeAtPosition(position);
      const symbolName = wordRange ? document.getText(wordRange) : 'symbol';

      const usages: SymbolUsage[] = [];
      // Take up to 3 cross-file references
      for (const ref of references) {
        if (ref.uri.toString() === document.uri.toString()) continue;
        if (usages.length >= 3) break;

        const refDoc = await vscode.workspace.openTextDocument(ref.uri);
        const line = refDoc.lineAt(ref.range.start.line).text.trim();
        
        usages.push({
          symbolName,
          context: line,
          filePath: vscode.workspace.asRelativePath(ref.uri),
          line: ref.range.start.line + 1
        });
      }

      return usages;
    } catch (err) {
      this.logger.debug('Failed to find symbol usages');
      return [];
    }
  }

  /**
   * Formats usages for the AI.
   */
  public formatForPrompt(usages: SymbolUsage[]): string {
    if (usages.length === 0) return '';

    const lines = usages.map(u => 
      `In ${u.filePath}:L${u.line}: "${u.context}"`
    );

    return `<symbol_usage_examples>\n${lines.join('\n')}\n</symbol_usage_examples>`;
  }
}
