/**
 * AutoCode Context Engine
 * 
 * The brain of the system. Builds deep, ranked context from:
 * - Current cursor position and file content
 * - Open editor tabs
 * - Related files via imports / symbol graph
 * - Git diffs and recent edits
 * - Agentic tools (Diagnostics, Imports, Definitions, History, Graph, Usage)
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
} from '../core/types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { SymbolAnalyzer } from './analyzers/symbol-analyzer';
import { ImportAnalyzer } from './analyzers/import-analyzer';
import { GitAnalyzer } from './analyzers/git-analyzer';
import { StyleAnalyzer } from '../style-learning/style-analyzer';
import { SemanticResolver } from './semantic-resolver';
import { ContextRanker } from './context-ranker';

// Agentic Tools
import { DiagnosticAnalyzer } from '../tools/diagnostic-analyzer';
import { ImportTool } from '../tools/import-tool';
import { DefinitionTool } from '../tools/definition-tool';
import { HistoryTool } from '../tools/history-tool';
import { ProjectGraphTool } from '../tools/project-graph-tool';
import { SymbolUsageTool } from '../tools/symbol-usage-tool';

const CURSOR_WINDOW_LINES = 60;
const MAX_RELATED_FILES = 8;
const MAX_SYMBOLS = 100;

export class ContextEngine implements vscode.Disposable {
  private config: ConfigManager;
  private logger: Logger;
  private eventBus: EventBus;
  private symbolAnalyzer: SymbolAnalyzer;
  private importAnalyzer: ImportAnalyzer;
  private gitAnalyzer: GitAnalyzer;
  private styleAnalyzer: StyleAnalyzer;
  private semanticResolver: SemanticResolver;
  private contextRanker: ContextRanker;
  
  private diagnosticAnalyzer: DiagnosticAnalyzer;
  private importTool: ImportTool;
  private definitionTool: DefinitionTool;
  private historyTool: HistoryTool;
  private projectGraphTool: ProjectGraphTool;
  private symbolUsageTool: SymbolUsageTool;

  private editHistory: EditEvent[] = [];
  private disposables: vscode.Disposable[] = [];
  private readonly MAX_EDIT_HISTORY = 100;
  
  private lastContext: ProjectContext | null = null;
  private lastPosition: string = '';

  constructor() {
    this.config = ConfigManager.getInstance();
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
    this.symbolAnalyzer = new SymbolAnalyzer();
    this.importAnalyzer = new ImportAnalyzer();
    this.gitAnalyzer = new GitAnalyzer();
    this.styleAnalyzer = new StyleAnalyzer();
    this.semanticResolver = new SemanticResolver();
    this.contextRanker = new ContextRanker();
    
    this.diagnosticAnalyzer = DiagnosticAnalyzer.getInstance();
    this.importTool = ImportTool.getInstance();
    this.definitionTool = DefinitionTool.getInstance();
    this.historyTool = HistoryTool.getInstance();
    this.projectGraphTool = ProjectGraphTool.getInstance();
    this.symbolUsageTool = SymbolUsageTool.getInstance();

    this.setupEditTracking();
  }

  /**
   * Build the full project context for a given position.
   */
  async buildContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<ProjectContext> {
    const timer = this.logger.time('ContextEngine.buildContext');

    try {
      const cursorContext = this.buildCursorContext(document, position);
      
      // FAST-PATH: Reuse context if typing on the same line and close to last position
      const posKey = `${document.uri.toString()}:${position.line}`;
      
      let characterDelta = 1000;
      if (this.lastPosition && this.lastPosition.startsWith(posKey)) {
          const parts = this.lastPosition.split(':');
          const lastChar = parseInt(parts[parts.length - 1]);
          if (!isNaN(lastChar)) {
              characterDelta = Math.abs(position.character - lastChar);
          }
      }

      if (this.lastContext && characterDelta < 5) {
        this.logger.debug('Context fast-path: reusing previous metadata');
        const fastContext: ProjectContext = {
            ...this.lastContext,
            currentFile: cursorContext
        };
        return fastContext;
      }

      // Critical context needed for every completion
      const [
        symbols, 
        imports, 
        diagAnalys, 
      ] = await Promise.all([
        this.symbolAnalyzer.getSymbols(document, token, MAX_SYMBOLS),
        this.importAnalyzer.analyzeImports(document),
        this.diagnosticAnalyzer.analyzeDiagnostics(document, position),
      ]);

      if (token.isCancellationRequested) {
        throw new Error('Context building cancelled');
      }

      // Non-critical context (can be empty or stale)
      const [
        openFiles,
        gitDiffs,
        importAnalys,
        fileHistory,
        projectRel
      ] = await Promise.all([
        this.getOpenFileContexts(document.uri).catch(() => []),
        this.gitAnalyzer.getRecentDiffs().catch(() => []),
        this.importTool.getImportPrompt(document).catch(() => ''),
        this.historyTool.getFileHistory(document.uri.fsPath).catch(() => []),
        this.projectGraphTool.findRelatedFiles(document).catch(() => [])
      ]);

      // Try to resolve definition and usage at cursor
      let resolvedDefinitions = '';
      let symbolUsages = '';
      const wordRange = document.getWordRangeAtPosition(position);
      
      if (wordRange) {
        const [def, usages] = await Promise.all([
            this.definitionTool.resolveDefinition(document, position).catch(() => null),
            this.symbolUsageTool.findUsages(document, position).catch(() => [])
        ]);
        
        if (def) {
          resolvedDefinitions = this.definitionTool.formatForPrompt([def]);
        }
        if (usages && usages.length > 0) {
          symbolUsages = this.symbolUsageTool.formatForPrompt(usages);
        }
      }

      const lineText = document.lineAt(position.line).text.trim();
      const isComplex = lineText.includes('.') || lineText.startsWith('import') || lineText.includes('(');
      
      const [relatedFiles, resolvedSignatures] = await Promise.all([
        this.findRelatedFiles(document, imports, symbols).catch(() => []),
        isComplex ? this.semanticResolver.resolveImportSignatures(document, imports, token).catch(() => []) : Promise.resolve([])
      ]);

      const projectStyle = this.styleAnalyzer.getDefaultStyle();
      const docDiagnostics = vscode.languages.getDiagnostics(document.uri);

      const rankedContext: ProjectContext = {
        currentFile: cursorContext,
        openFiles: openFiles as FileContext[],
        relatedFiles: relatedFiles as FileContext[],
        symbols,
        imports,
        gitDiffs: gitDiffs as GitDiff[],
        recentEdits: this.getRecentEdits(),
        projectStyle,
        resolvedSignatures: resolvedSignatures as string[],
        diagnostics: docDiagnostics,
        diagnosticSummary: this.diagnosticAnalyzer.formatForPrompt(diagAnalys),
        importSuggestions: importAnalys as string,
        resolvedDefinitions: resolvedDefinitions,
        projectRelationships: this.projectGraphTool.formatForPrompt(projectRel as any),
        symbolUsages: symbolUsages,
        fileHistory: this.historyTool.formatForPrompt(fileHistory as any)
      };

      const compressed = this.contextRanker.rankAndCompress(
        rankedContext,
        this.config.getValue('maxContextTokens')
      );

      // Cache for fast-path
      this.lastContext = compressed;
      this.lastPosition = `${document.uri.toString()}:${position.line}:${position.character}`;

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
      return this.buildFallbackContext(document, position);
    }
  }

  private buildCursorContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): CursorContext {
    const line = document.lineAt(position.line);
    const linePrefix = line.text.substring(0, position.character);
    const lineSuffix = line.text.substring(position.character);

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

    const indentMatch = line.text.match(/^(\s*)/);
    const indentation = indentMatch ? indentMatch[1] : '';

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

  private async findRelatedFiles(
    document: vscode.TextDocument,
    imports: ImportInfo[],
    _symbols: SymbolInfo[]
  ): Promise<FileContext[]> {
    const relatedUris = new Set<string>();
    const relatedFiles: FileContext[] = [];

    for (const imp of imports) {
      if (imp.resolvedPath) {
        relatedUris.add(imp.resolvedPath);
      }
    }

    const currentRelPath = vscode.workspace.asRelativePath(document.uri);
    const reverseImports = await this.importAnalyzer.findReverseImports(
      currentRelPath
    );
    for (const uri of reverseImports) {
      relatedUris.add(uri);
    }

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

  private setupEditTracking(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const change of e.contentChanges) {
          const edit: EditEvent = {
            file: vscode.workspace.asRelativePath(e.document.uri),
            timestamp: Date.now(),
            range: change.range,
            newText: change.text,
            oldText: '',
          };
          this.editHistory.push(edit);
          if (this.editHistory.length > this.MAX_EDIT_HISTORY) {
            this.editHistory.shift();
          }
        }
      })
    );
  }

  private getRecentEdits(): EditEvent[] {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return this.editHistory.filter((e) => e.timestamp > fiveMinutesAgo);
  }

  private async buildFallbackContext(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<ProjectContext> {
    return {
      currentFile: this.buildCursorContext(document, position),
      openFiles: [],
      relatedFiles: [],
      symbols: [],
      imports: [],
      gitDiffs: [],
      recentEdits: [],
      projectStyle: this.styleAnalyzer.getDefaultStyle(),
    };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
