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
  private currentDecorations: Map<string, vscode.Range[]> = new Map();
  private activeTarget: { file: string; position: vscode.Position } | null = null;

  constructor() {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      before: {
        contentText: ' TAB to jump here ',
        backgroundColor: new vscode.ThemeColor('peekViewEditor.background'),
        color: new vscode.ThemeColor('peekViewEditor.foreground'),
        margin: '0 0.5em 0 0',
        fontWeight: '600',
      },
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
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
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {return;}

    const targetUri = vscode.Uri.joinPath(wsFolder.uri, target.file);
    
    // Apply decoration to all visible editors that match the target URI
    for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === targetUri.toString()) {
            const range = new vscode.Range(target.position, target.position);
            editor.setDecorations(this.decorationType, [range]);
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
    }
  }

  public dispose(): void {
    this.clearIndicators();
    this.decorationType.dispose();
  }
}
