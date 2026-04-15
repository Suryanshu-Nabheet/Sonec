/**
 * SONEC Symbol Analyzer
 * 
 * Extracts symbol information (functions, classes, variables, types)
 * from the current document and workspace using VS Code's built-in
 * document symbol provider and workspace symbol search.
 */

import * as vscode from 'vscode';
import { SymbolInfo } from '../../core/types';
import { Logger } from '../../core/logger';

export class SymbolAnalyzer {
  private logger = Logger.getInstance();
  private symbolCache = new Map<string, { symbols: SymbolInfo[]; version: number }>();

  /**
   * Get symbols from the current document and related workspace symbols
   */
  async getSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
    maxSymbols: number
  ): Promise<SymbolInfo[]> {
    const timer = this.logger.time('SymbolAnalyzer.getSymbols');

    try {
      // Check cache
      const cached = this.symbolCache.get(document.uri.toString());
      if (cached && cached.version === document.version) {
        timer();
        return cached.symbols;
      }

      // Get document symbols (fast — local to file)
      const docSymbols = await this.getDocumentSymbols(document, token);
      
      // Get workspace symbols referenced from this file (slower — async)
      const referencedSymbols = await this.getReferencedSymbols(document, token);

      const allSymbols = [...docSymbols, ...referencedSymbols].slice(0, maxSymbols);

      // Cache
      this.symbolCache.set(document.uri.toString(), {
        symbols: allSymbols,
        version: document.version,
      });

      timer();
      return allSymbols;
    } catch (err) {
      this.logger.error('Symbol analysis failed', err);
      timer();
      return [];
    }
  }

  /**
   * Get all symbols defined in the current document
   */
  private async getDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<SymbolInfo[]> {
    try {
      const symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >('vscode.executeDocumentSymbolProvider', document.uri);

      if (!symbols) {return [];}

      return this.flattenSymbols(symbols, document.uri.fsPath);
    } catch {
      return [];
    }
  }

  /**
   * Find workspace symbols that are referenced in the current document
   */
  private async getReferencedSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<SymbolInfo[]> {
    const text = document.getText();
    const identifiers = this.extractIdentifiers(text);
    const results: SymbolInfo[] = [];
    const seen = new Set<string>();

    // Query workspace for each unique identifier
    // Limit to avoid excessive queries
    const topIdentifiers = identifiers.slice(0, 20);

    for (const id of topIdentifiers) {
      if (seen.has(id)) {continue;}
      seen.add(id);

      try {
        const wsSymbols = await vscode.commands.executeCommand<
          vscode.SymbolInformation[]
        >('vscode.executeWorkspaceSymbolProvider', id);

        if (wsSymbols) {
          for (const sym of wsSymbols.slice(0, 3)) {
            if (sym.location.uri.toString() === document.uri.toString()) {continue;}
            results.push({
              name: sym.name,
              kind: sym.kind,
              range: sym.location.range,
              containerName: sym.containerName,
              filePath: sym.location.uri.fsPath,
            });
          }
        }
      } catch {
        // Symbol provider might not be available for all languages
      }
    }

    return results;
  }

  /**
   * Flatten nested DocumentSymbol tree into flat SymbolInfo array
   */
  private flattenSymbols(
    symbols: vscode.DocumentSymbol[],
    filePath: string,
    containerName?: string
  ): SymbolInfo[] {
    const result: SymbolInfo[] = [];

    for (const sym of symbols) {
      result.push({
        name: sym.name,
        kind: sym.kind,
        range: sym.range,
        containerName,
        detail: sym.detail,
        filePath,
      });

      if (sym.children && sym.children.length > 0) {
        result.push(
          ...this.flattenSymbols(sym.children, filePath, sym.name)
        );
      }
    }

    return result;
  }

  /**
   * Extract potential identifiers from source code text.
   * Used to find workspace symbols referenced in the file.
   */
  private extractIdentifiers(text: string): string[] {
    // Match PascalCase and camelCase identifiers (likely imports/references)
    const regex = /\b([A-Z][a-zA-Z0-9]{2,})\b/g;
    const identifiers = new Set<string>();
    let match;

    while ((match = regex.exec(text)) !== null) {
      identifiers.add(match[1]);
    }

    return Array.from(identifiers);
  }

  /** Invalidate cache for a specific file */
  invalidate(uri: vscode.Uri): void {
    this.symbolCache.delete(uri.toString());
  }

  /** Clear entire symbol cache */
  clearCache(): void {
    this.symbolCache.clear();
  }
}
