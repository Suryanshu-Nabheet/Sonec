/**
 * AutoCode Import Optimizer Tool
 * 
 * Analyzes the file for missing imports or unresolved symbols
 * and provides suggestions to the AI.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

export class ImportTool {
  private static instance: ImportTool;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): ImportTool {
    if (!ImportTool.instance) {
      ImportTool.instance = new ImportTool();
    }
    return ImportTool.instance;
  }

  /**
   * Identifies symbols that likely need imports.
   */
  public async findMissingImports(document: vscode.TextDocument): Promise<string[]> {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    
    // Filter for "Cannot find name" or similar errors (TS2304, etc.)
    const missingSymbols = diagnostics
      .filter(d => 
        typeof d.code === 'number' && [2304, 2552, 2503].includes(d.code) || 
        d.message.includes('Cannot find name')
      )
      .map(d => {
        const match = d.message.match(/'([^']+)'/);
        return match ? match[1] : '';
      })
      .filter(name => name !== '');

    return Array.from(new Set(missingSymbols));
  }

  /**
   * Searches the workspace for potential import sources for a symbol.
   */
  public async searchImportSources(symbolName: string): Promise<string[]> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        symbolName
      );

      if (!symbols) return [];

      return symbols
        .filter(s => s.name === symbolName)
        .map(s => vscode.workspace.asRelativePath(s.location.uri))
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  /**
   * Formats import suggestions for the AI.
   */
  public async getImportPrompt(document: vscode.TextDocument): Promise<string> {
    const missing = await this.findMissingImports(document);
    if (missing.length === 0) return '';

    const suggestions: string[] = [];
    for (const name of missing) {
      const sources = await this.searchImportSources(name);
      if (sources.length > 0) {
        suggestions.push(`  - ${name}: Available in ${sources.join(', ')}`);
      } else {
        suggestions.push(`  - ${name}: Definition not found in workspace`);
      }
    }

    return `<import_suggestions>\n${suggestions.join('\n')}\n</import_suggestions>`;
  }
}
