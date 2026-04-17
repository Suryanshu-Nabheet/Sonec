/**
 * SONEC Context Engine
 * 
 * The brain of the system. Builds deep, ranked context from:
 * - Current cursor position and file content
 * - Open editor tabs
 * - Related files via imports / symbol graph
 * - Git diffs and recent edits
 * - Project-level style patterns
 * 
 * Outputs a compressed, ranked ProjectContext suitable for the model layer.
 */

import * as vscode from 'vscode';
import {
  ProjectContext,
  CursorContext,
  FileContext,
  SymbolInfo,
  ImportInfo,
  EditEvent,
  GitDiff,
  ProjectStyle,
} from '../core/types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { SymbolAnalyzer } from './analyzers/symbol-analyzer';
import { ImportAnalyzer } from './analyzers/import-analyzer';
import { GitAnalyzer } from './analyzers/git-analyzer';
import { TrajectoryEngine } from '../prediction/trajectory-engine';
import { SemanticResolver } from './semantic-resolver';
import { StyleAnalyzer } from '../style-learning/style-analyzer';
import { ContextRanker } from './context-ranker';

/** Number of preceding/following lines to include around cursor */
const CURSOR_WINDOW_LINES = 60;

/** Maximum related files to include in context */
const MAX_RELATED_FILES = 8;

/** Maximum symbols to include */
const MAX_SYMBOLS = 100;

/**
 * Manages the assembly and ranking of contextual information for code generation.
 */
export class ContextEngine implements vscode.Disposable {
  private config: ConfigManager;
  private logger: Logger;
  private eventBus: EventBus;
  private symbolAnalyzer: SymbolAnalyzer;
  private importAnalyzer: ImportAnalyzer;
  private gitAnalyzer: GitAnalyzer;
  private styleAnalyzer: StyleAnalyzer;
  private trajectoryEngine: TrajectoryEngine;
  private semanticResolver: SemanticResolver;
  private contextRanker: ContextRanker;
  private editHistory: EditEvent[] = [];
  private disposables: vscode.Disposable[] = [];
  private readonly MAX_EDIT_HISTORY = 100;

  constructor() {
    this.config = ConfigManager.getInstance();
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
    this.symbolAnalyzer = new SymbolAnalyzer();
    this.importAnalyzer = new ImportAnalyzer();
    this.gitAnalyzer = new GitAnalyzer();
    this.styleAnalyzer = new StyleAnalyzer();
    this.trajectoryEngine = TrajectoryEngine.getInstance();
    this.semanticResolver = new SemanticResolver();
    this.contextRanker = new ContextRanker();

    this.setupEditTracking();
  }

  /**
   * Build the full project context for a given position.
   * This is the primary method called by the completion provider.
   * @param document The current text document
   * @param position The current cursor position
   * @param token The cancellation token
   * @returns A promise that resolves to the assembled project context
   */
  async buildContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<ProjectContext> {
    const timer = this.logger.time('ContextEngine.buildContext');

    try {
      // Get basic context points
      const cursorContext = this.buildCursorContext(document, position);
      const openFiles = await this.getOpenFileContexts(document.uri);
      const symbols = await this.symbolAnalyzer.getSymbols(document, token, MAX_SYMBOLS);
      const imports = await this.importAnalyzer.analyzeImports(document);
      const gitDiffs = await this.gitAnalyzer.getRecentDiffs();
      const trajectory = this.trajectoryEngine.getTrajectoryContext();
      const impacts = await this.getSymbolImpacts(document, position, token);
      
      // Short-circuit semantic resolver if not needed for performance
      let resolvedSignatures: string[] = [];
      const lineText = document.lineAt(position.line).text.trim();
      const isComplex = lineText.includes('.') || lineText.startsWith('import') || lineText.includes('(');
      
      if (isComplex) {
        resolvedSignatures = await this.semanticResolver.resolveImportSignatures(document, imports, token);
      } else {
        this.logger.debug('Skipping semantic resolution for simple line');
      }

      if (token.isCancellationRequested) {
        throw new Error('Context building cancelled');
      }

      // Find related files based on imports and symbol usage
      const relatedFiles = await this.findRelatedFiles(
        document,
        imports,
        symbols
      );

      // Use a standard style snapshot in the hot-path
      const projectStyle = this.styleAnalyzer.getDefaultStyle();

      // Get standard diagnostics for the current file
      const docDiagnostics = vscode.languages.getDiagnostics(document.uri);

      // Rank and compress context to fit model's token budget
      const rankedContext: ProjectContext = {
        currentFile: cursorContext,
        openFiles,
        relatedFiles,
        symbols,
        imports,
        gitDiffs,
        recentEdits: this.getRecentEdits(),
        projectStyle,
        trajectory,
        impacts,
        resolvedSignatures,
        diagnostics: docDiagnostics,
      };

      const compressed = this.contextRanker.rankAndCompress(
        rankedContext,
        this.config.getValue('maxContextTokens')
      );

      const elapsed = timer();
      this.eventBus.emit({
        type: 'context_rebuilt',
        data: {
          tokenCount: this.config.getValue('maxContextTokens'),
          latencyMs: elapsed,
        },
      });

      return compressed;
    } catch (err) {
      timer();
      this.logger.error('Failed to build context', err);
      // Return minimal fallback context
      return this.buildFallbackContext(document, position);
    }
  }

  /**
   * Find where current symbol is referenced in other files to assess impact.
   * @param document The current text document
   * @param position The current cursor position
   * @param token The cancellation token
   * @returns A promise that resolves to an array of impact strings
   */
  private async getSymbolImpacts(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<string[]> {
    try {
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        position
      );

      if (!refs || refs.length === 0) return [];

      // Filter to find references in other files
      const externalRefs = refs.filter(ref => ref.uri.fsPath !== document.uri.fsPath);
      
      // Limit to 3 most relevant impacts to avoid token bloat
      return externalRefs.slice(0, 3).map(ref => {
        const relPath = vscode.workspace.asRelativePath(ref.uri);
        return `Referenced in ${relPath}:L${ref.range.start.line + 1}`;
      });
    } catch {
      return [];
    }
  }

  /**
   * Build cursor-local context with surrounding code window.
   * @param document The current text document
   * @param position The current cursor position
   * @returns The cursor context
   */
  private buildCursorContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): CursorContext {
    const line = document.lineAt(position.line);
    const linePrefix = line.text.substring(0, position.character);
    const lineSuffix = line.text.substring(position.character);

    // Extract surrounding lines
    const startLine = Math.max(0, position.line - CURSOR_WINDOW_LINES);
    const endLine = Math.min(
      document.lineCount - 1,
      position.line + CURSOR_WINDOW_LINES
    );

    const precedingRange = new vscode.Range(startLine, 0, position.line, 0);
    const followingRange = new vscode.Range(
      position.line + 1,
      0,
      endLine,
      document.lineAt(endLine).text.length
    );

    const precedingLines = document.getText(precedingRange);
    const followingLines =
      position.line < document.lineCount - 1
        ? document.getText(followingRange)
        : '';

    // Detect indentation at cursor
    const indentMatch = line.text.match(/^(\s*)/);
    const indentation = indentMatch ? indentMatch[1] : '';

    // Get selection if any
    const editor = vscode.window.activeTextEditor;
    const selectedText =
      editor && !editor.selection.isEmpty
        ? document.getText(editor.selection)
        : undefined;

    const fileContext = this.buildFileContext(document);

    return {
      file: fileContext,
      position,
      linePrefix,
      lineSuffix,
      precedingLines,
      followingLines,
      selectedText,
      indentation,
    };
  }

  /**
   * Build a FileContext from a TextDocument.
   * @param document The text document
   * @returns The file context
   */
  private buildFileContext(document: vscode.TextDocument): FileContext {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const relativePath = workspaceFolder
      ? vscode.workspace.asRelativePath(document.uri)
      : document.fileName;

    return {
      uri: document.uri,
      relativePath,
      languageId: document.languageId,
      content: document.getText(),
      version: document.version,
      lineCount: document.lineCount,
      diagnostics: vscode.languages.getDiagnostics(document.uri),
    };
  }

  /**
   * Get contexts for all open editor tabs (excluding current file).
   * @param currentUri The current file's URI
   * @returns A promise that resolves to an array of open file contexts
   */
  private async getOpenFileContexts(
    currentUri: vscode.Uri
  ): Promise<FileContext[]> {
    const openFiles: FileContext[] = [];

    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if (uri.toString() === currentUri.toString()) {continue;}

          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            openFiles.push(this.buildFileContext(doc));
          } catch {
            // File might have been deleted or become unavailable
          }
        }
      }
    }

    return openFiles;
  }

  /**
   * Find files related to the current document through imports and symbols.
   * @param document The current document
   * @param imports The imports in the current document
   * @param _symbols The symbols in the current document
   * @returns A promise that resolves to an array of related file contexts
   */
  private async findRelatedFiles(
    document: vscode.TextDocument,
    imports: ImportInfo[],
    _symbols: SymbolInfo[]
  ): Promise<FileContext[]> {
    if (!this.config.getValue('multiFileEnabled')) {
      return [];
    }

    const relatedUris = new Set<string>();
    const relatedFiles: FileContext[] = [];

    // Resolve import paths to actual files
    for (const imp of imports) {
      if (imp.resolvedPath) {
        relatedUris.add(imp.resolvedPath);
      }
    }

    // Also find files that import this file
    const currentRelPath = vscode.workspace.asRelativePath(document.uri);
    const reverseImports = await this.importAnalyzer.findReverseImports(
      currentRelPath
    );
    for (const uri of reverseImports) {
      relatedUris.add(uri);
    }

    // Load related files (limited to MAX_RELATED_FILES)
    let count = 0;
    for (const uriStr of relatedUris) {
      if (count >= MAX_RELATED_FILES) {break;}
      try {
        const uri = vscode.Uri.file(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        relatedFiles.push(this.buildFileContext(doc));
        count++;
      } catch {
        // File not found, skip
      }
    }

    return relatedFiles;
  }

  /**
   * Track document edits for recent-edit context.
   */
  private setupEditTracking(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const change of e.contentChanges) {
          const edit: EditEvent = {
            file: vscode.workspace.asRelativePath(e.document.uri),
            timestamp: Date.now(),
            range: change.range,
            newText: change.text,
            oldText: '', // We can't easily get old text from this event
          };
          this.editHistory.push(edit);
          if (this.editHistory.length > this.MAX_EDIT_HISTORY) {
            this.editHistory.shift();
          }
        }
      })
    );
  }

  /**
   * Get recent edits within the last 5 minutes.
   * @returns An array of recent edits
   */
  private getRecentEdits(): EditEvent[] {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return this.editHistory.filter((e) => e.timestamp > fiveMinutesAgo);
  }

  /**
   * Minimal fallback context when full context building fails.
   * @param document The text document
   * @param position The cursor position
   * @returns A promise that resolves to a minimal project context
   */
  private async buildFallbackContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<ProjectContext> {
    return {
      currentFile: await this.buildCursorContext(document, position),
      openFiles: [],
      relatedFiles: [],
      symbols: [],
      imports: [],
      gitDiffs: [],
      recentEdits: [],
      projectStyle: this.styleAnalyzer.getDefaultStyle(),
    };
  }

  /**
   * Disposes the context engine resources.
   */
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
