/**
 * SONEC Action Execution Engine
 * 
 * Safely applies structured edit actions to workspace files.
 * Implements:
 *  - Atomic multi-file edits via WorkspaceEdit
 *  - Action validation and conflict detection
 *  - Undo stack with reverse-action generation
 *  - Transaction management
 * 
 * This is the critical interface between AI predictions and real code changes.
 */

import * as vscode from 'vscode';
import {
  StructuredAction,
  ActionPlan,
  EditTransaction,
  UndoEntry,
  InsertAction,
  ReplaceAction,
  DeleteAction,
  CreateFileAction,
} from '../core/types';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';

/** Maximum undo history entries */
const MAX_UNDO_STACK = 50;

export class ActionExecutionEngine implements vscode.Disposable {
  private logger: Logger;
  private eventBus: EventBus;
  private undoStack: UndoEntry[] = [];
  private activeTransactions: Map<string, EditTransaction> = new Map();
  private idCounter = 0;

  constructor() {
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Execute an entire action plan atomically.
   * All edits succeed together or all are rolled back.
   */
  async executePlan(plan: ActionPlan): Promise<boolean> {
    const timer = this.logger.time(`ActionExecution.executePlan [${plan.id}]`);

    const transaction: EditTransaction = {
      id: this.generateId(),
      actions: plan.actions,
      status: 'pending',
    };

    this.activeTransactions.set(transaction.id, transaction);

    try {
      // Validate all actions first
      const validationErrors = await this.validateActions(plan.actions);
      if (validationErrors.length > 0) {
        this.logger.warn(
          'Action validation failed',
          validationErrors
        );
        transaction.status = 'failed';
        transaction.error = validationErrors.join('; ');
        timer();
        return false;
      }

      // Sort actions to avoid position conflicts (process from bottom to top)
      const sortedActions = this.sortActionsForExecution(plan.actions);

      // Group actions by file
      const fileGroups = this.groupByFile(sortedActions);

      // Build workspace edit
      transaction.status = 'applying';
      const workspaceEdit = new vscode.WorkspaceEdit();
      const reverseActions: StructuredAction[] = [];

      for (const [filePath, actions] of fileGroups) {
        for (const action of actions) {
          const reverseAction = await this.addActionToEdit(
            workspaceEdit,
            action,
            filePath
          );
          if (reverseAction) {
            reverseActions.push(reverseAction);
          }
        }
      }

      // Apply atomically
      const success = await vscode.workspace.applyEdit(workspaceEdit);

      if (success) {
        transaction.status = 'applied';

        // Push undo entry
        const undoEntry: UndoEntry = {
          id: this.generateId(),
          timestamp: Date.now(),
          actionPlanId: plan.id,
          reverseActions,
          description: plan.reasoning || `Applied ${plan.actions.length} actions`,
        };
        transaction.undoEntry = undoEntry;
        this.pushUndo(undoEntry);

        this.eventBus.emit({
          type: 'action_applied',
          data: { actionPlanId: plan.id, success: true },
        });

        this.logger.info(
          `Action plan ${plan.id} applied successfully (${plan.actions.length} actions)`
        );
      } else {
        transaction.status = 'failed';
        transaction.error = 'WorkspaceEdit.applyEdit returned false';

        this.eventBus.emit({
          type: 'action_applied',
          data: { actionPlanId: plan.id, success: false },
        });
      }

      timer();
      return success;
    } catch (err) {
      transaction.status = 'failed';
      transaction.error = err instanceof Error ? err.message : String(err);
      this.logger.error('Action execution failed', err);
      timer();
      return false;
    } finally {
      this.activeTransactions.delete(transaction.id);
    }
  }

  /**
   * Execute a single action
   */
  async executeAction(action: StructuredAction): Promise<boolean> {
    return this.executePlan({
      id: this.generateId(),
      timestamp: Date.now(),
      actions: [action],
      totalConfidence: action.confidence,
    });
  }

  /**
   * Undo the last applied action plan
   */
  async undo(): Promise<boolean> {
    const entry = this.undoStack.pop();
    if (!entry) {
      this.logger.info('Nothing to undo');
      return false;
    }

    this.logger.info(`Undoing: ${entry.description}`);

    // Apply reverse actions
    return this.executePlan({
      id: this.generateId(),
      timestamp: Date.now(),
      actions: entry.reverseActions,
      reasoning: `Undo: ${entry.description}`,
      totalConfidence: 1.0,
    });
  }

  /**
   * Get the undo stack for inspection
   */
  getUndoStack(): ReadonlyArray<UndoEntry> {
    return this.undoStack;
  }

  // ─────────────────────────────────────────────────────────
  // Validation
  // ─────────────────────────────────────────────────────────

  /**
   * Validate all actions before execution
   */
  private async validateActions(
    actions: StructuredAction[]
  ): Promise<string[]> {
    const errors: string[] = [];

    for (const action of actions) {
      switch (action.type) {
        case 'insert': {
          const insertAction = action as InsertAction;
          if (insertAction.code === undefined || insertAction.code === null) {
            errors.push(`Insert action missing code for ${action.file}`);
          }
          break;
        }
        case 'replace': {
          const replaceAction = action as ReplaceAction;
          if (replaceAction.code === undefined) {
            errors.push(`Replace action missing code for ${action.file}`);
          }
          if (
            replaceAction.range.startLine > replaceAction.range.endLine
          ) {
            errors.push(
              `Replace action has invalid range for ${action.file}`
            );
          }
          break;
        }
        case 'delete': {
          const deleteAction = action as DeleteAction;
          if (
            deleteAction.range.startLine > deleteAction.range.endLine
          ) {
            errors.push(
              `Delete action has invalid range for ${action.file}`
            );
          }
          break;
        }
        case 'create_file': {
          const createAction = action as CreateFileAction;
          if (!createAction.code || !createAction.relativePath) {
            errors.push('Create file action missing code or path');
          }
          break;
        }
      }

      // Validate confidence threshold
      if (action.confidence < 0.3) {
        errors.push(
          `Action confidence too low (${action.confidence}) for ${action.file}`
        );
      }
    }

    // Check for overlapping ranges in the same file
    const fileActions = this.groupByFile(actions);
    for (const [file, acts] of fileActions) {
      if (
        this.hasOverlappingRanges(
          acts.filter((a) => a.type === 'replace' || a.type === 'delete')
        )
      ) {
        errors.push(`Overlapping edit ranges detected in ${file}`);
      }
    }

    return errors;
  }

  /**
   * Check if any two actions have overlapping ranges
   */
  private hasOverlappingRanges(actions: StructuredAction[]): boolean {
    const ranges = actions
      .map((a) => {
        if (a.type === 'replace') {
          return {
            start: (a as ReplaceAction).range.startLine,
            end: (a as ReplaceAction).range.endLine,
          };
        }
        if (a.type === 'delete') {
          return {
            start: (a as DeleteAction).range.startLine,
            end: (a as DeleteAction).range.endLine,
          };
        }
        return null;
      })
      .filter(Boolean) as { start: number; end: number }[];

    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (
          ranges[i].start <= ranges[j].end &&
          ranges[j].start <= ranges[i].end
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────
  // Edit Application
  // ─────────────────────────────────────────────────────────

  /**
   * Add a single action to a WorkspaceEdit, returning the reverse action
   */
  private async addActionToEdit(
    workspaceEdit: vscode.WorkspaceEdit,
    action: StructuredAction,
    filePath: string
  ): Promise<StructuredAction | null> {
    const uri = await this.resolveFileUri(filePath);
    if (!uri && action.type !== 'create_file') {
      this.logger.warn(`File not found: ${filePath}`);
      return null;
    }

    switch (action.type) {
      case 'insert':
        return this.applyInsert(
          workspaceEdit,
          uri!,
          action as InsertAction
        );

      case 'replace':
        return this.applyReplace(
          workspaceEdit,
          uri!,
          action as ReplaceAction
        );

      case 'delete':
        return this.applyDelete(
          workspaceEdit,
          uri!,
          action as DeleteAction
        );

      case 'create_file':
        return this.applyCreateFile(
          workspaceEdit,
          action as CreateFileAction
        );

      default:
        this.logger.warn(`Unknown action type: ${action.type}`);
        return null;
    }
  }

  private async applyInsert(
    edit: vscode.WorkspaceEdit,
    uri: vscode.Uri,
    action: InsertAction
  ): Promise<StructuredAction> {
    const position = new vscode.Position(
      action.position.line,
      action.position.character
    );

    edit.insert(uri, position, action.code);

    // Reverse: delete what we just inserted
    const insertedLines = action.code.split('\n');
    const endLine = action.position.line + insertedLines.length - 1;
    const endChar =
      insertedLines.length === 1
        ? action.position.character + action.code.length
        : insertedLines[insertedLines.length - 1].length;

    return {
      type: 'delete',
      file: action.file,
      range: {
        startLine: action.position.line,
        startCharacter: action.position.character,
        endLine,
        endCharacter: endChar,
      },
      confidence: 1.0,
    };
  }

  private async applyReplace(
    edit: vscode.WorkspaceEdit,
    uri: vscode.Uri,
    action: ReplaceAction
  ): Promise<StructuredAction | null> {
    const range = new vscode.Range(
      action.range.startLine,
      action.range.startCharacter,
      action.range.endLine,
      action.range.endCharacter
    );

    // Get existing text for undo
    let oldText = '';
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      oldText = doc.getText(range);
    } catch {
      // File might not be open
    }

    edit.replace(uri, range, action.code);

    // Reverse: replace back with old text
    return {
      type: 'replace',
      file: action.file,
      range: {
        startLine: action.range.startLine,
        startCharacter: action.range.startCharacter,
        endLine: action.range.startLine + action.code.split('\n').length - 1,
        endCharacter:
          action.code.split('\n').length === 1
            ? action.range.startCharacter + action.code.length
            : action.code.split('\n').pop()!.length,
      },
      code: oldText,
      confidence: 1.0,
    };
  }

  private async applyDelete(
    edit: vscode.WorkspaceEdit,
    uri: vscode.Uri,
    action: DeleteAction
  ): Promise<StructuredAction | null> {
    const range = new vscode.Range(
      action.range.startLine,
      action.range.startCharacter,
      action.range.endLine,
      action.range.endCharacter
    );

    // Get existing text for undo
    let oldText = '';
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      oldText = doc.getText(range);
    } catch {
      // File might not be open
    }

    edit.delete(uri, range);

    // Reverse: re-insert deleted text
    return {
      type: 'insert',
      file: action.file,
      position: {
        line: action.range.startLine,
        character: action.range.startCharacter,
      },
      code: oldText,
      confidence: 1.0,
    };
  }

  private async applyCreateFile(
    edit: vscode.WorkspaceEdit,
    action: CreateFileAction
  ): Promise<StructuredAction | null> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {return null;}

    const uri = vscode.Uri.joinPath(wsFolder.uri, action.relativePath);
    edit.createFile(uri, { overwrite: false, ignoreIfExists: true });
    edit.insert(uri, new vscode.Position(0, 0), action.code);

    // Reverse: delete the created file
    return {
      type: 'delete',
      file: action.file,
      range: {
        startLine: 0,
        startCharacter: 0,
        endLine: action.code.split('\n').length,
        endCharacter: 0,
      },
      confidence: 1.0,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────

  /**
   * Sort actions to process bottom-to-top to avoid position shifts
   */
  private sortActionsForExecution(
    actions: StructuredAction[]
  ): StructuredAction[] {
    return [...actions].sort((a, b) => {
      const lineA = this.getActionLine(a);
      const lineB = this.getActionLine(b);
      return lineB - lineA; // Bottom to top
    });
  }

  private getActionLine(action: StructuredAction): number {
    switch (action.type) {
      case 'insert':
        return (action as InsertAction).position.line;
      case 'replace':
        return (action as ReplaceAction).range.startLine;
      case 'delete':
        return (action as DeleteAction).range.startLine;
      default:
        return 0;
    }
  }

  /**
   * Group actions by their target file
   */
  private groupByFile(
    actions: StructuredAction[]
  ): Map<string, StructuredAction[]> {
    const groups = new Map<string, StructuredAction[]>();
    for (const action of actions) {
      const file = action.file;
      if (!groups.has(file)) {
        groups.set(file, []);
      }
      groups.get(file)!.push(action);
    }
    return groups;
  }

  /**
   * Resolve a relative file path to a Uri
   */
  private async resolveFileUri(
    filePath: string
  ): Promise<vscode.Uri | null> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {return null;}

    const uri = vscode.Uri.joinPath(wsFolder.uri, filePath);
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      // Try as absolute path
      try {
        const absUri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.stat(absUri);
        return absUri;
      } catch {
        return null;
      }
    }
  }

  private pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
  }

  private generateId(): string {
    return `tx_${Date.now()}_${++this.idCounter}`;
  }

  dispose(): void {
    this.undoStack = [];
    this.activeTransactions.clear();
  }
}
