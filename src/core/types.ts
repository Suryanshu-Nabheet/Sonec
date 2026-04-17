/**
 * SONEC Core Type Definitions
 * 
 * Central type system for the entire SONEC engine.
 * All modules reference these types to ensure consistency.
 */

import * as vscode from 'vscode';

/**
 * Supported model providers.
 */
export type ModelProvider = 'openai' | 'anthropic' | 'ollama' | 'custom';

/**
 * Logging levels.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Comprehensive configuration for the SONEC extension.
 */
export interface SonecConfig {
  enabled: boolean;
  provider: ModelProvider;
  model: string;
  apiKey: string;
  apiEndpoint: string;
  maxContextTokens: number;
  debounceMs: number;
  prefetchEnabled: boolean;
  multiFileEnabled: boolean;
  maxCompletionLines: number;
  streamingEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
  styleLearnEnabled: boolean;
  telemetryEnabled: boolean;
  logLevel: LogLevel;
}

/**
 * Types of structured edit operations.
 */
export type ActionType = 'insert' | 'replace' | 'delete' | 'move' | 'create_file';

/**
 * Base interface for all structured actions.
 */
export interface BaseAction {
  type: ActionType;
  file: string;
  confidence: number; // 0-1 score
  description?: string;
}

/**
 * Represents an insertion of code at a specific position.
 */
export interface InsertAction extends BaseAction {
  type: 'insert';
  position: {
    line: number;
    character: number;
  };
  code: string;
}

/**
 * Represents a replacement of a code range with new content.
 */
export interface ReplaceAction extends BaseAction {
  type: 'replace';
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
  code: string;
}

/**
 * Represents a deletion of a code range.
 */
export interface DeleteAction extends BaseAction {
  type: 'delete';
  range: {
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  };
}

/**
 * Represents moving a range of code to another location or file.
 */
export interface MoveAction extends BaseAction {
  type: 'move';
  sourceRange: {
    startLine: number;
    endLine: number;
  };
  destinationFile: string;
  destinationLine: number;
}

/**
 * Represents the creation of a new file with content.
 */
export interface CreateFileAction extends BaseAction {
  type: 'create_file';
  code: string;
  relativePath: string;
}

/**
 * Union type for all possible structured actions.
 */
export type StructuredAction =
  | InsertAction
  | ReplaceAction
  | DeleteAction
  | MoveAction
  | CreateFileAction;

/**
 * A collection of actions to be executed together as a logical change.
 */
export interface ActionPlan {
  id: string;
  timestamp: number;
  actions: StructuredAction[];
  reasoning?: string;
  totalConfidence: number;
}

/**
 * Metadata and content snapshot for a file in the workspace.
 */
export interface FileContext {
  uri: vscode.Uri;
  relativePath: string;
  languageId: string;
  content: string;
  version: number;
  lineCount: number;
  diagnostics?: any[]; // Simplified to avoid circularity or complex mapping
}

/**
 * Granular context around the current cursor position.
 */
export interface CursorContext {
  file: FileContext;
  position: vscode.Position;
  linePrefix: string;     // text before cursor on current line
  lineSuffix: string;     // text after cursor on current line
  precedingLines: string; // N lines before cursor
  followingLines: string; // N lines after cursor
  selectedText?: string;
  indentation: string;    // detected indentation at cursor
}

/**
 * Information about a project symbol (class, function, variable, etc.).
 */
export interface SymbolInfo {
  name: string;
  kind: vscode.SymbolKind;
  range: vscode.Range;
  containerName?: string;
  detail?: string;
  filePath: string;
}

/**
 * Information about a module import.
 */
export interface ImportInfo {
  moduleName: string;
  importedSymbols: string[];
  isDefault: boolean;
  isNamespace: boolean;
  filePath: string;
  resolvedPath?: string;
}

/**
 * Represents a set of changes in a file from Git perspective.
 */
export interface GitDiff {
  filePath: string;
  hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    content: string;
  }>;
}

/**
 * Full project context used as input for predictions.
 */
export interface ProjectContext {
  currentFile: CursorContext;
  openFiles: FileContext[];
  relatedFiles: FileContext[];
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  gitDiffs: GitDiff[];
  recentEdits: EditEvent[];
  projectStyle: ProjectStyle;
  trajectory?: string;
  impacts?: string[];
  resolvedSignatures?: string[];
  diagnostics?: any[];
}

/**
 * Represents a single edit event in the editor.
 */
export interface EditEvent {
  file: string;
  timestamp: number;
  range: vscode.Range;
  newText: string;
  oldText: string;
}

/**
 * Detected project-wide coding style and patterns.
 */
export interface ProjectStyle {
  indentation: 'tabs' | 'spaces';
  indentSize: number;
  semicolons: boolean;
  quoteStyle: 'single' | 'double';
  trailingComma: boolean;
  maxLineLength: number;
  namingConventions: {
    variables: 'camelCase' | 'snake_case' | 'PascalCase';
    functions: 'camelCase' | 'snake_case' | 'PascalCase';
    classes: 'PascalCase' | 'camelCase';
    constants: 'UPPER_SNAKE' | 'camelCase';
    files: 'kebab-case' | 'camelCase' | 'PascalCase' | 'snake_case';
  };
  patterns: PatternSignature[];
}

/**
 * A recurring code pattern signature.
 */
export interface PatternSignature {
  name: string;
  frequency: number;
  example: string;
  context: string;
}

/**
 * The result of a single code completion request.
 */
export interface CompletionResult {
  id: string;
  text: string;
  insertText: string;
  range: vscode.Range;
  confidence: number;
  source: 'inline' | 'block' | 'transformation';
  metadata: {
    modelLatencyMs: number;
    contextTokens: number;
    completionTokens: number;
    cached: boolean;
  };
}

/**
 * An edit that was predicted but not yet applied.
 */
export interface PredictedEdit {
  id: string;
  file: string;
  position: vscode.Position;
  preview: string;
  actions: StructuredAction[];
  confidence: number;
  category: 'completion' | 'refactor' | 'fix' | 'enhancement';
  appliedAt?: number;
}

/**
 * A prediction of the next location where the user might want to edit.
 */
export interface NextEditPrediction {
  file: string;
  position: vscode.Position;
  reason: string;
  confidence: number;
  suggestedAction?: StructuredAction;
}

/**
 * Parameters for a model inference request.
 */
export interface ModelRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  stopSequences?: string[];
  stream: boolean;
}

/**
 * The response from a model inference request.
 */
export interface ModelResponse {
  text: string;
  finishReason: 'stop' | 'length' | 'error';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

/**
 * A single chunk of a streaming model response.
 */
export interface StreamChunk {
  text: string;
  done: boolean;
}

/**
 * Callback for processing streaming response chunks.
 */
export type StreamCallback = (chunk: StreamChunk) => void;

/**
 * A generic cache entry.
 */
export interface CacheEntry<T> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  hits: number;
  hash: string;
}

/**
 * Statistics for cache performance tracking.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
}

/**
 * Aggregated performance metrics for the extension.
 */
export interface PerformanceMetrics {
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  totalRequests: number;
  cacheHitRate: number;
  averageContextTokens: number;
  completionsAccepted: number;
  completionsDismissed: number;
  acceptanceRate: number;
}

/**
 * Union type for all possible extension events.
 */
export type SonecEvent =
  | { type: 'completion_triggered'; data: { file: string; position: vscode.Position } }
  | { type: 'completion_shown'; data: { id: string; confidence: number } }
  | { type: 'completion_accepted'; data: { id: string; partial: boolean } }
  | { type: 'completion_dismissed'; data: { id: string; reason: string } }
  | { type: 'action_applied'; data: { actionPlanId: string; success: boolean } }
  | { type: 'next_edit_jumped'; data: { file: string; position: vscode.Position } }
  | { type: 'context_rebuilt'; data: { tokenCount: number; latencyMs: number } }
  | { type: 'cache_hit'; data: { key: string } }
  | { type: 'next_edits_updated'; data: { predictions: NextEditPrediction[] } }
  | { type: 'error'; data: { message: string; stack?: string } };

/**
 * Handler function for extension events.
 */
export type SonecEventHandler = (event: SonecEvent) => void;

/**
 * Represents a historical entry that can be used for undo operations.
 */
export interface UndoEntry {
  id: string;
  timestamp: number;
  actionPlanId: string;
  reverseActions: StructuredAction[];
  description: string;
}

/**
 * Represents a group of actions being applied as a single transaction.
 */
export interface EditTransaction {
  id: string;
  actions: StructuredAction[];
  status: 'pending' | 'applying' | 'applied' | 'rolled_back' | 'failed';
  undoEntry?: UndoEntry;
  error?: string;
}
