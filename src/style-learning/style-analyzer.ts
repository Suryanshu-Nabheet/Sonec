/**
 * AutoCode Style Analyzer
 * 
 * Learns and detects project-specific coding style patterns including:
 * - Indentation (tabs vs spaces, indent size)
 * - Quote style (single vs double)
 * - Semicolons
 * - Naming conventions
 * - Trailing commas
 * - Line length
 */

import * as vscode from 'vscode';
import { ProjectStyle, PatternSignature } from '../core/types';
import { Logger } from '../core/logger';

/**
 * Orchestrates the detection and enforcement of project-specific coding styles.
 */
export class StyleAnalyzer {
  private logger = Logger.getInstance();
  private cachedStyle: ProjectStyle | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL = 60_000; // 1 minute
  private styleRejections: string[] = [];

  /**
   * Records a manual correction to a style pattern.
   * This is used to "teach" the model when it drifts from project conventions.
   * @param expected The expected code string
   * @param actual The actual code string that was generated
   */
  public recordCorrection(expected: string, actual: string): void {
    const correction = `${actual} -> ${expected}`;
    if (!this.styleRejections.includes(correction)) {
      this.styleRejections.unshift(correction);
      if (this.styleRejections.length > 5) this.styleRejections.pop();
      this.logger.info(`Style correction recorded: ${correction}`);
    }
  }

  /**
   * Gets a list of recent style corrections to feed into the prompt.
   * @returns An array of correction strings
   */
  public getStyleCorrections(): string[] {
    return this.styleRejections;
  }

  /**
   * Analyze the project style from the current and nearby files.
   * @param document The current text document
   * @returns A promise that resolves to the detected project style
   */
  async analyzeStyle(document: vscode.TextDocument): Promise<ProjectStyle> {
    // Return cached if fresh
    if (
      this.cachedStyle &&
      Date.now() - this.cacheTimestamp < this.CACHE_TTL
    ) {
      return this.cachedStyle;
    }

    const timer = this.logger.time('StyleAnalyzer.analyzeStyle');
    const text = document.getText();

    try {
      // Also sample a few other files for broader style detection
      const otherTexts = await this.sampleProjectFiles(document.uri);
      const allTexts = [text, ...otherTexts];

      const style: ProjectStyle = {
        indentation: this.detectIndentation(allTexts),
        indentSize: this.detectIndentSize(allTexts),
        semicolons: this.detectSemicolons(text),
        quoteStyle: this.detectQuoteStyle(text),
        trailingComma: this.detectTrailingComma(text),
        maxLineLength: this.detectMaxLineLength(allTexts),
        namingConventions: {
          variables: this.detectNamingConvention(text, 'variable'),
          functions: this.detectNamingConvention(text, 'function'),
          classes: 'PascalCase',
          constants: this.detectConstantStyle(text),
          files: this.detectFileNaming(),
        },
        patterns: this.detectPatterns(text),
      };

      this.cachedStyle = style;
      this.cacheTimestamp = Date.now();
      timer();
      return style;
    } catch (err) {
      timer();
      this.logger.error('Style analysis failed', err);
      return this.getDefaultStyle();
    }
  }

  /**
   * Get a sensible default style.
   * @returns A project style object with default values
   */
  getDefaultStyle(): ProjectStyle {
    return {
      indentation: 'spaces',
      indentSize: 2,
      semicolons: true,
      quoteStyle: 'single',
      trailingComma: true,
      maxLineLength: 100,
      namingConventions: {
        variables: 'camelCase',
        functions: 'camelCase',
        classes: 'PascalCase',
        constants: 'UPPER_SNAKE',
        files: 'kebab-case',
      },
      patterns: [],
    };
  }

  /**
   * Detects the indentation type (tabs or spaces).
   * @param texts An array of file content strings
   * @returns 'tabs' or 'spaces'
   */
  private detectIndentation(texts: string[]): 'tabs' | 'spaces' {
    let tabCount = 0;
    let spaceCount = 0;

    for (const text of texts) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('\t')) {tabCount++;}
        else if (line.match(/^ {2,}/)) {spaceCount++;}
      }
    }

    return tabCount > spaceCount ? 'tabs' : 'spaces';
  }

  /**
   * Detects the indentation size.
   * @param texts An array of file content strings
   * @returns The detected indentation size
   */
  private detectIndentSize(texts: string[]): number {
    const indentCounts: Record<number, number> = { 2: 0, 4: 0, 8: 0 };

    for (const text of texts) {
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/^( +)/);
        if (match) {
          const size = match[1].length;
          if (size % 4 === 0) {indentCounts[4]++;}
          else if (size % 2 === 0) {indentCounts[2]++;}
        }
      }
    }

    // Return the most common indent size
    let maxCount = 0;
    let bestSize = 2;
    for (const [size, count] of Object.entries(indentCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestSize = parseInt(size);
      }
    }
    return bestSize;
  }

  /**
   * Detects if semicolons are consistently used.
   * @param text The file content string
   * @returns True if semicolons are the norm
   */
  private detectSemicolons(text: string): boolean {
    const lines = text.split('\n').filter((l) => l.trim());
    const withSemicolon = lines.filter((l) => l.trimEnd().endsWith(';'));
    return withSemicolon.length > lines.length * 0.3;
  }

  /**
   * Detects the preferred quote style.
   * @param text The file content string
   * @returns 'single' or 'double'
   */
  private detectQuoteStyle(text: string): 'single' | 'double' {
    const singleQuotes = (text.match(/'/g) || []).length;
    const doubleQuotes = (text.match(/"/g) || []).length;
    return singleQuotes > doubleQuotes ? 'single' : 'double';
  }

  /**
   * Detects if trailing commas are used.
   * @param text The file content string
   * @returns True if trailing commas are detected
   */
  private detectTrailingComma(text: string): boolean {
    const trailingCommas = (text.match(/,\s*[\]})\n]/g) || []).length;
    const noTrailingCommas = (text.match(/[^,]\s*[\]})\n]/g) || []).length;
    return trailingCommas > noTrailingCommas * 0.3;
  }

  /**
   * Detects the maximum line length.
   * @param texts An array of file content strings
   * @returns The 95th percentile line length
   */
  private detectMaxLineLength(texts: string[]): number {
    let maxLen = 0;
    const lengths: number[] = [];

    for (const text of texts) {
      for (const line of text.split('\n')) {
        const len = line.length;
        if (len > 10) {
          lengths.push(len);
          if (len > maxLen) {maxLen = len;}
        }
      }
    }

    // Use the 95th percentile as effective max
    lengths.sort((a, b) => a - b);
    const p95Idx = Math.floor(lengths.length * 0.95);
    return lengths[p95Idx] || 100;
  }

  /**
   * Detects naming conventions for variables and functions.
   * @param text The file content string
   * @param type The element type to analyze
   * @returns The detected naming convention
   */
  private detectNamingConvention(
    text: string,
    type: 'variable' | 'function'
  ): 'camelCase' | 'snake_case' | 'PascalCase' {
    let camelCount = 0;
    let snakeCount = 0;

    const pattern =
      type === 'variable'
        ? /(?:const|let|var)\s+(\w+)/g
        : /(?:function)\s+(\w+)/g;

    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1];
      if (name.includes('_')) {snakeCount++;}
      else if (name[0] === name[0].toLowerCase()) {camelCount++;}
    }

    return snakeCount > camelCount ? 'snake_case' : 'camelCase';
  }

  /**
   * Detects the style used for constants.
   * @param text The file content string
   * @returns The detected constant style
   */
  private detectConstantStyle(
    text: string
  ): 'UPPER_SNAKE' | 'camelCase' {
    const upperSnake = (text.match(/const\s+[A-Z][A-Z_0-9]+\s*=/g) || [])
      .length;
    const camelConst = (text.match(/const\s+[a-z][a-zA-Z0-9]+\s*=/g) || [])
      .length;
    return upperSnake > camelConst * 0.3 ? 'UPPER_SNAKE' : 'camelCase';
  }

  /**
   * Detects the file naming convention.
   * @returns The detected file naming convention
   */
  private detectFileNaming(): 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case' {
    return 'kebab-case';
  }

  /**
   * Detects common code patterns.
   * @param text The file content string
   * @returns An array of detected pattern signatures
   */
  private detectPatterns(text: string): PatternSignature[] {
    const patterns: PatternSignature[] = [];

    // Detect common patterns
    if (text.includes('export default function')) {
      patterns.push({
        name: 'default-export-function',
        frequency: (text.match(/export default function/g) || []).length,
        example: 'export default function Component() {}',
        context: 'module-export',
      });
    }

    if (text.includes('async/await')) {
      patterns.push({
        name: 'async-await',
        frequency: (text.match(/async\s/g) || []).length,
        example: 'async function fetchData() { const data = await api.get(); }',
        context: 'async-operations',
      });
    }

    if (text.includes('try {') || text.includes('try{')) {
      patterns.push({
        name: 'try-catch',
        frequency: (text.match(/try\s*\{/g) || []).length,
        example: 'try { ... } catch (err) { ... }',
        context: 'error-handling',
      });
    }

    return patterns;
  }

  /**
   * Samples a few project files for broader style detection.
   * @param currentUri The current file's URI
   * @returns A promise that resolves to an array of content sample strings
   */
  private async sampleProjectFiles(
    currentUri: vscode.Uri
  ): Promise<string[]> {
    try {
      const pattern = '**/*.{ts,tsx,js,jsx,py}';
      const files = await vscode.workspace.findFiles(
        pattern,
        '**/node_modules/**',
        5
      );

      const texts: string[] = [];
      for (const file of files) {
        if (file.toString() === currentUri.toString()) {continue;}
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          // Only use first 200 lines per file for speed
          texts.push(
            doc
              .getText()
              .split('\n')
              .slice(0, 200)
              .join('\n')
          );
        } catch {
          // Skip unreadable files
        }
      }
      return texts;
    } catch {
      return [];
    }
  }

  /** Invalidate cached style */
  invalidate(): void {
    this.cachedStyle = null;
    this.cacheTimestamp = 0;
  }
}
