/**
 * SONEC Import Analyzer
 * 
 * Parses import/require statements across multiple languages to build
 * dependency graphs and find cross-file relationships.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ImportInfo } from '../../core/types';
import { Logger } from '../../core/logger';

/** Language-specific import patterns */
const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /import\s+(?:type\s+)?(\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
  ],
  javascript: [
    /import\s+(\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /const\s+(\{[^}]+\}|\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  python: [
    /from\s+(\S+)\s+import\s+(.+)/g,
    /import\s+(\S+)(?:\s+as\s+\w+)?/g,
  ],
  go: [
    /import\s+"([^"]+)"/g,
    /import\s+\w+\s+"([^"]+)"/g,
  ],
  rust: [
    /use\s+([\w:]+)(?:::\{([^}]+)\})?/g,
  ],
};

const LANGUAGE_ALIASES: Record<string, string> = {
  typescriptreact: 'typescript',
  javascriptreact: 'javascript',
};

export class ImportAnalyzer {
  private logger = Logger.getInstance();
  private importCache = new Map<string, { imports: ImportInfo[]; version: number }>();

  /**
   * Analyze all imports in a document
   */
  analyzeImports(document: vscode.TextDocument): ImportInfo[] {
    // Check cache
    const cached = this.importCache.get(document.uri.toString());
    if (cached && cached.version === document.version) {
      return cached.imports;
    }

    const langId = LANGUAGE_ALIASES[document.languageId] || document.languageId;
    const patterns = IMPORT_PATTERNS[langId];

    if (!patterns) {
      return [];
    }

    const text = document.getText();
    const imports: ImportInfo[] = [];

    for (const pattern of patterns) {
      // Reset regex state
      pattern.lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        const importInfo = this.parseImportMatch(
          match,
          langId,
          document.uri.fsPath
        );
        if (importInfo) {
          imports.push(importInfo);
        }
      }
    }

    // Resolve relative paths to absolute paths
    for (const imp of imports) {
      imp.resolvedPath = this.resolveImportPath(
        imp.moduleName,
        document.uri.fsPath
      );
    }

    // Cache
    this.importCache.set(document.uri.toString(), {
      imports,
      version: document.version,
    });

    return imports;
  }

  /**
   * Find files that import a given file path (reverse dependency lookup)
   */
  async findReverseImports(relativePath: string): Promise<string[]> {
    const results: string[] = [];
    const basename = path.basename(relativePath, path.extname(relativePath));

    try {
      // Search for files containing the import path
      const pattern = `**/*.{ts,tsx,js,jsx,py,go,rs}`;
      const files = await vscode.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        50
      );

      for (const fileUri of files) {
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const text = doc.getText();

          // Simple check: does this file import our target?
          if (
            text.includes(`'${basename}'`) ||
            text.includes(`"${basename}"`) ||
            text.includes(`'./${basename}'`) ||
            text.includes(`"./${basename}"`)
          ) {
            results.push(fileUri.fsPath);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch (err) {
      this.logger.error('Reverse import search failed', err);
    }

    return results;
  }

  /**
   * Parse a regex match into an ImportInfo object
   */
  private parseImportMatch(
    match: RegExpExecArray,
    langId: string,
    filePath: string
  ): ImportInfo | null {
    try {
      if (langId === 'typescript' || langId === 'javascript') {
        return this.parseTSImport(match, filePath);
      }
      if (langId === 'python') {
        return this.parsePythonImport(match, filePath);
      }
      if (langId === 'go') {
        return this.parseGoImport(match, filePath);
      }
      if (langId === 'rust') {
        return this.parseRustImport(match, filePath);
      }
    } catch {
      return null;
    }
    return null;
  }

  private parseTSImport(
    match: RegExpExecArray,
    filePath: string
  ): ImportInfo | null {
    const fullMatch = match[0];

    // Side-effect import: import 'module'
    if (match.length === 2 && !fullMatch.includes('from')) {
      return {
        moduleName: match[1],
        importedSymbols: [],
        isDefault: false,
        isNamespace: false,
        filePath,
      };
    }

    const symbolsOrDefault = match[1];
    const moduleName = match[2] || match[1];

    const isNamespace = fullMatch.includes('* as');
    const isDefault = !symbolsOrDefault.startsWith('{') && !isNamespace;

    let importedSymbols: string[] = [];
    if (symbolsOrDefault.startsWith('{')) {
      importedSymbols = symbolsOrDefault
        .replace(/[{}]/g, '')
        .split(',')
        .map((s) => s.trim().split(' as ')[0].trim())
        .filter(Boolean);
    } else {
      importedSymbols = [symbolsOrDefault.trim()];
    }

    return {
      moduleName,
      importedSymbols,
      isDefault,
      isNamespace,
      filePath,
    };
  }

  private parsePythonImport(
    match: RegExpExecArray,
    filePath: string
  ): ImportInfo | null {
    if (match[0].startsWith('from')) {
      const moduleName = match[1];
      const symbols = match[2]
        .split(',')
        .map((s) => s.trim().split(' as ')[0].trim())
        .filter(Boolean);
      return {
        moduleName,
        importedSymbols: symbols,
        isDefault: false,
        isNamespace: false,
        filePath,
      };
    }
    return {
      moduleName: match[1],
      importedSymbols: [],
      isDefault: true,
      isNamespace: false,
      filePath,
    };
  }

  private parseGoImport(
    match: RegExpExecArray,
    filePath: string
  ): ImportInfo | null {
    return {
      moduleName: match[1],
      importedSymbols: [],
      isDefault: false,
      isNamespace: true,
      filePath,
    };
  }

  private parseRustImport(
    match: RegExpExecArray,
    filePath: string
  ): ImportInfo | null {
    const moduleName = match[1];
    const symbols = match[2]
      ? match[2].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    return {
      moduleName,
      importedSymbols: symbols,
      isDefault: false,
      isNamespace: symbols.length === 0,
      filePath,
    };
  }

  /**
   * Resolve a module name to an absolute file path
   */
  private resolveImportPath(
    moduleName: string,
    fromFile: string
  ): string | undefined {
    // Only resolve relative imports
    if (!moduleName.startsWith('.')) {
      return undefined;
    }

    const dir = path.dirname(fromFile);
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', ''];

    for (const ext of extensions) {
      const resolved = path.resolve(dir, moduleName + ext);
      return resolved; // We'll let the caller check if it exists
    }

    return undefined;
  }

  /** Invalidate cache for a file */
  invalidate(uri: vscode.Uri): void {
    this.importCache.delete(uri.toString());
  }

  /** Clear entire cache */
  clearCache(): void {
    this.importCache.clear();
  }
}
