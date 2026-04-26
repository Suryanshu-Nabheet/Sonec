import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { NextEditPrediction } from '../core/types';

/**
 * Manages the visual indicators for predicted next edits.
 * Dual-layer UI:
 * 1. SOURCE: Dynamic badge at current cursor showing jump target.
 * 2. TARGET: Subtle marker in destination file overview ruler and ghost text preview.
 */
export class JumpIndicatorManager implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  
  // Decorations for the TARGET location
  private readonly targetHighlightType: vscode.TextEditorDecorationType;
  private readonly targetPreviewType: vscode.TextEditorDecorationType;
  
  // Decorations for the SOURCE (current cursor) location
  private readonly sourceBadgeType: vscode.TextEditorDecorationType;
  
  private activeTarget: NextEditPrediction | null = null;
  private isDisposed = false;

  constructor() {
    // 1. Highlight the target in the overview ruler only (minimal distraction)
    this.targetHighlightType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    // 2. Faint ghost text preview at the target destination
    this.targetPreviewType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        fontStyle: 'italic',
        margin: '0 0 0 1em',
      }
    });

    // 3. The "TAB to jump" badge at the ACTIVE cursor position
    this.sourceBadgeType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('descriptionForeground'),
        backgroundColor: new vscode.ThemeColor('badge.background'),
        margin: '0 0 0 2em',
        border: '1px solid #444',
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

    const allPredictions = Array.isArray(predictions) ? predictions : [predictions];
    const sorted = [...allPredictions].sort((a, b) => b.confidence - a.confidence);
    this.activeTarget = sorted[0];

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;

    this.renderSourceBadge(activeEditor, this.activeTarget);
    this.renderTargetHighlights(sorted);
  }

  /**
   * Render the "TAB to jump" badge in the active editor at the current cursor line.
   */
  private renderSourceBadge(editor: vscode.TextEditor, target: NextEditPrediction): void {
    const currentLine = editor.selection.active.line;
    const currentLineRange = editor.document.lineAt(currentLine).range;

    // Determine dynamic badge text based on relative destination
    let badgeText = '';
    const targetFileName = target.file.split(/[/\\]/).pop() || target.file;
    const isDifferentFile = !editor.document.uri.fsPath.toLowerCase().endsWith(target.file.toLowerCase().replace(/\\/g, '/').split('/').pop() || '');
    
    if (isDifferentFile) {
        badgeText = ` ⇥ TAB to ${targetFileName} `;
    } else {
        const lineDiff = target.position.line - currentLine;
        if (lineDiff === 0) {
            // Already at target - don't show badge if suggestion will be shown
            return;
        } else {
            badgeText = ` ⇥ TAB to line ${target.position.line + 1} `;
        }
    }

    const decoration: vscode.DecorationOptions = {
        range: currentLineRange,
        hoverMessage: new vscode.MarkdownString(`### Next Edit Prediction\n\n**Reason:** ${target.reason}\n\n**Confidence:** ${(target.confidence * 100).toFixed(0)}%`),
        renderOptions: {
            after: {
                contentText: badgeText,
                color: target.confidence > 0.8 ? new vscode.ThemeColor('button.foreground') : new vscode.ThemeColor('descriptionForeground'),
                backgroundColor: target.confidence > 0.8 ? new vscode.ThemeColor('button.background') : new vscode.ThemeColor('badge.background'),
                border: '1px solid #555',
            }
        }
    };
    
    editor.setDecorations(this.sourceBadgeType, [decoration]);
  }

  /**
   * Render highlights and previews in all visible editors where targets are located.
   */
  private renderTargetHighlights(predictions: NextEditPrediction[]): void {
    const visibleEditors = vscode.window.visibleTextEditors;
    if (visibleEditors.length === 0) return;

    for (const target of predictions) {
        const isPrimary = target === this.activeTarget;
        const targetUri = this.resolveUri(target.file);
        if (!targetUri) continue;

        for (const editor of visibleEditors) {
            if (editor.document.uri.fsPath === targetUri.fsPath) {
                const line = Math.min(target.position.line, editor.document.lineCount - 1);
                const lineRange = editor.document.lineAt(line).range;
                
                // Overview ruler marker
                editor.setDecorations(this.targetHighlightType, [lineRange]);

                // Ghost text preview for the primary target
                if (isPrimary && target.suggestedAction && 'code' in target.suggestedAction && target.suggestedAction.code) {
                    const previewText = target.suggestedAction.code.split('\n')[0].trim();
                    if (previewText) {
                        editor.setDecorations(this.targetPreviewType, [{
                            range: lineRange,
                            renderOptions: {
                                after: { contentText: `  // Suggested: ${previewText}${target.suggestedAction.code.includes('\n') ? ' ...' : ''}` }
                            }
                        }]);
                    }
                }
            }
        }
    }
  }

  private resolveUri(filePath: string): vscode.Uri | null {
    try {
        if (vscode.Uri.parse(filePath).scheme === 'file' || filePath.startsWith('/') || /^[a-zA-Z]:/.test(filePath)) {
            return vscode.Uri.file(filePath);
        }
        const wsFolder = vscode.workspace.workspaceFolders?.[0];
        return wsFolder ? vscode.Uri.joinPath(wsFolder.uri, filePath) : vscode.Uri.file(filePath);
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
        editor.setDecorations(this.targetHighlightType, []);
        editor.setDecorations(this.targetPreviewType, []);
        editor.setDecorations(this.sourceBadgeType, []);
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.clearIndicators();
    this.targetHighlightType.dispose();
    this.targetPreviewType.dispose();
    this.sourceBadgeType.dispose();
  }
}



