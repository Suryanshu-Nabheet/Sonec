/**
 * SONEC Jump Indicator UI
 * 
 * Manages the visual cues for jump-to-edit predictions.
 * Displays a "TAB to jump here" badge at the target location.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

export class JumpIndicatorManager implements vscode.Disposable {
  private logger = Logger.getInstance();
  private decorationType: vscode.TextEditorDecorationType;
  private promptDecorationType: vscode.TextEditorDecorationType;
  private activeTarget: { file: string; position: vscode.Position } | null = null;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      before: {
        contentText: ' TAB to jump here ',
        backgroundColor: new vscode.ThemeColor('peekViewEditor.background'),
        color: new vscode.ThemeColor('peekViewEditor.foreground'),
        margin: '0 0.5em 0 0',
        fontWeight: '600',
        border: '1px solid #007acc',
      },
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });

    this.promptDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: ' (TAB to jump) ',
            color: new vscode.ThemeColor('editorGhostText.foreground'),
            fontStyle: 'italic',
            backgroundColor: new vscode.ThemeColor('editor.lineHighlightBackground'),
            margin: '0 0 0 1em',
        }
    });
  }

  /**
   * Update the jump indicator for a given target.
   * @param target The file and position of the predicted next edit
   */
  public updateIndicator(target: { file: string; position: vscode.Position } | null): void {
    this.clearIndicators();
    if (!target) {
        this.activeTarget = null;
        return;
    }

    this.activeTarget = target;
    
    // Resolve target URI robustly
    let targetUri: vscode.Uri;
    try {
        if (vscode.Uri.parse(target.file).scheme !== 'file' && !target.file.startsWith('/') && !target.file.includes(':')) {
            const wsFolder = vscode.workspace.workspaceFolders?.[0];
            targetUri = wsFolder ? vscode.Uri.joinPath(wsFolder.uri, target.file) : vscode.Uri.file(target.file);
        } else {
            targetUri = vscode.Uri.file(target.file);
        }
    } catch {
        const wsFolder = vscode.workspace.workspaceFolders?.[0];
        targetUri = wsFolder ? vscode.Uri.joinPath(wsFolder.uri, target.file) : vscode.Uri.file(target.file);
    }
    
    // Apply decorations to all visible editors
    for (const editor of vscode.window.visibleTextEditors) {
        // 1. Target indicator (at the destination)
        if (editor.document.uri.fsPath === targetUri.fsPath) {
            const range = new vscode.Range(target.position, target.position);
            editor.setDecorations(this.decorationType, [range]);
        }
        
        // 2. Prompt indicator (at the current cursor)
        if (this.activeTarget) {
            const cursorPosition = editor.selection.active;
            const range = new vscode.Range(cursorPosition, cursorPosition);
            editor.setDecorations(this.promptDecorationType, [range]);
        }
    }
  }

  /**
   * Check if there is an active jump target.
   */
  public hasActiveTarget(): boolean {
    return !!this.activeTarget;
  }

  /**
   * Get the current active jump target.
   */
  public getActiveTarget(): { file: string; position: vscode.Position } | null {
    return this.activeTarget;
  }

  /**
   * Clear all indicators from all editors.
   */
  public clearIndicators(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        editor.setDecorations(this.decorationType, []);
        editor.setDecorations(this.promptDecorationType, []);
    }
  }

  public dispose(): void {
    this.clearIndicators();
    this.decorationType.dispose();
    this.promptDecorationType.dispose();
  }
}
