import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { NextEditPrediction } from '../core/types';

/**
 * Manages the visual indicators for predicted next edits.
 * Shows a subtle inline badge at the cursor line (e.g. "⇥ TAB to fix line 42")
 * and an overview ruler marker at the target.
 */
export class JumpIndicatorManager implements vscode.Disposable {
  private readonly logger = Logger.getInstance();

  // Overview ruler marker at the TARGET location
  private readonly targetRulerType: vscode.TextEditorDecorationType;

  // Badge at the SOURCE (current cursor) location
  private readonly sourceBadgeType: vscode.TextEditorDecorationType;

  private activeTarget: NextEditPrediction | null = null;
  private isDisposed = false;

  constructor() {
    this.targetRulerType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    this.sourceBadgeType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('descriptionForeground'),
        backgroundColor: new vscode.ThemeColor('badge.background'),
        margin: '0 0 0 2em',
        border: '1px solid #555',
        fontWeight: 'bold',
      }
    });
  }

  /**
   * Update all visual indicators based on the latest predictions.
   */
  public updateIndicator(predictions: NextEditPrediction[] | NextEditPrediction | null): void {
    if (this.isDisposed) return;

    this.clearIndicators();

    if (!predictions || (Array.isArray(predictions) && predictions.length === 0)) {
      this.activeTarget = null;
      return;
    }

    const all = Array.isArray(predictions) ? predictions : [predictions];
    const sorted = [...all].sort((a, b) => b.confidence - a.confidence);
    this.activeTarget = sorted[0];

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Don't show badge when cursor is already at the target (let ghost text take over)
    const cursorLine = editor.selection.active.line;
    const targetLine = this.activeTarget.position.line;
    const isSameFile = this.isFileMatch(editor.document.uri, this.activeTarget.file);

    if (isSameFile && cursorLine === targetLine) {
      // At destination — no badge needed, ghost text handles it
      return;
    }

    this.renderSourceBadge(editor, this.activeTarget);
    this.renderTargetRuler(sorted);
  }

  /**
   * Render the "TAB to ..." badge at the current cursor line.
   */
  private renderSourceBadge(editor: vscode.TextEditor, target: NextEditPrediction): void {
    const cursorLine = editor.selection.active.line;
    const lineRange = editor.document.lineAt(cursorLine).range;

    const badgeText = this.buildBadgeText(editor, target);
    if (!badgeText) return;

    const highConf = target.confidence > 0.7;

    const decoration: vscode.DecorationOptions = {
      range: lineRange,
      hoverMessage: new vscode.MarkdownString(
        `### Next Edit\n\n**${target.reason}**\n\nConfidence: ${(target.confidence * 100).toFixed(0)}%`
      ),
      renderOptions: {
        after: {
          contentText: badgeText,
          color: highConf
            ? new vscode.ThemeColor('button.foreground')
            : new vscode.ThemeColor('descriptionForeground'),
          backgroundColor: highConf
            ? new vscode.ThemeColor('button.background')
            : new vscode.ThemeColor('badge.background'),
          border: '1px solid #555',
        }
      }
    };

    editor.setDecorations(this.sourceBadgeType, [decoration]);
  }

  /**
   * Build the badge text based on the action type and target location.
   */
  private buildBadgeText(editor: vscode.TextEditor, target: NextEditPrediction): string {
    const fileName = target.file.split(/[/\\]/).pop() || target.file;
    const isDifferentFile = !this.isFileMatch(editor.document.uri, target.file);

    if (isDifferentFile) {
      return ` ⇥ TAB to ${fileName} `;
    }

    const actionType = target.suggestedAction?.type;
    const lineNum = target.position.line + 1;

    if (actionType === 'delete') {
      return ` ⇥ TAB to remove (line ${lineNum}) `;
    }
    if (actionType === 'replace') {
      return ` ⇥ TAB to fix (line ${lineNum}) `;
    }

    // Default: generic jump
    return ` ⇥ TAB to line ${lineNum} `;
  }

  /**
   * Mark the target lines in the overview ruler.
   */
  private renderTargetRuler(predictions: NextEditPrediction[]): void {
    for (const target of predictions) {
      const targetUri = this.resolveUri(target.file);
      if (!targetUri) continue;

      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.fsPath === targetUri.fsPath) {
          const line = Math.min(target.position.line, editor.document.lineCount - 1);
          editor.setDecorations(this.targetRulerType, [editor.document.lineAt(line).range]);
        }
      }
    }
  }

  /**
   * Check if a document URI matches a prediction file path.
   */
  private isFileMatch(docUri: vscode.Uri, predFile: string): boolean {
    const docName = docUri.fsPath.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
    const predName = predFile.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
    return docName === predName;
  }

  private resolveUri(filePath: string): vscode.Uri | null {
    try {
      if (filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
        return vscode.Uri.file(filePath);
      }
      const ws = vscode.workspace.workspaceFolders?.[0];
      return ws ? vscode.Uri.joinPath(ws.uri, filePath) : vscode.Uri.file(filePath);
    } catch {
      return null;
    }
  }

  public hasActiveTarget(): boolean {
    return !!this.activeTarget;
  }

  public getActiveTarget(): NextEditPrediction | null {
    return this.activeTarget;
  }

  public clearIndicators(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.targetRulerType, []);
      editor.setDecorations(this.sourceBadgeType, []);
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.clearIndicators();
    this.targetRulerType.dispose();
    this.sourceBadgeType.dispose();
  }
}
