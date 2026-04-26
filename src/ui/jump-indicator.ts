import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { NextEditPrediction } from '../core/types';

export class JumpIndicatorManager implements vscode.Disposable {
  private logger = Logger.getInstance();
  
  // Decorations for the TARGET location
  private targetHighlightType: vscode.TextEditorDecorationType;
  private targetPreviewType: vscode.TextEditorDecorationType;
  
  // Decorations for the SOURCE (current cursor) location
  private sourceBadgeType: vscode.TextEditorDecorationType;
  
  private activeTarget: NextEditPrediction | null = null;

  constructor() {
    // 1. Highlight the target in the overview ruler only (no background on line)
    this.targetHighlightType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    // 2. Faint ghost text preview at the target
    this.targetPreviewType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        fontStyle: 'italic',
      }
    });

    // 3. The "TAB to jump" badge at the CURRENT cursor position
    this.sourceBadgeType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('descriptionForeground'),
        backgroundColor: new vscode.ThemeColor('badge.background'),
        margin: '0 0 0 2em',
        border: '1px solid #444',
        borderRadius: '3px',
        fontWeight: 'bold',
        padding: '0 4px',
      }
    });
  }

  /**
   * Update the jump indicator for given targets.
   * @param predictions All predicted next edits
   */
  public updateIndicator(predictions: NextEditPrediction[] | NextEditPrediction | null): void {
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

    // --- 1. Render SOURCE Badge (in active editor at current line) ---
    const primaryTarget = this.activeTarget;
    const currentLine = activeEditor.selection.active.line;
    const currentLineRange = activeEditor.document.lineAt(currentLine).range;

    let badgeText = ' ⇥ TAB to jump';
    const targetFileName = primaryTarget.file.split('/').pop() || primaryTarget.file;
    
    // Check if target is in a different file or different line
    const isDifferentFile = activeEditor.document.uri.fsPath.toLowerCase().endsWith(primaryTarget.file.toLowerCase()) === false;
    
    if (isDifferentFile) {
        badgeText = ` ⇥ TAB to ${targetFileName}`;
    } else {
        const lineDiff = primaryTarget.position.line - currentLine;
        if (lineDiff === 0) {
            // Target is right here!
            badgeText = ' ⇥ TAB to edit';
        } else {
            badgeText = ` ⇥ TAB to line ${primaryTarget.position.line + 1}`;
        }
    }

    const sourceDecoration: vscode.DecorationOptions = {
        range: currentLineRange,
        hoverMessage: new vscode.MarkdownString(`### Next Edit Prediction\n\n**Reason:** ${primaryTarget.reason}\n\n**Confidence:** ${(primaryTarget.confidence * 100).toFixed(0)}%`),
        renderOptions: {
            after: {
                contentText: badgeText,
                // Brighten badge for high confidence
                color: primaryTarget.confidence > 0.8 ? new vscode.ThemeColor('button.foreground') : undefined,
                backgroundColor: primaryTarget.confidence > 0.8 ? new vscode.ThemeColor('button.background') : undefined,
            }
        }
    };
    activeEditor.setDecorations(this.sourceBadgeType, [sourceDecoration]);

    // --- 2. Render TARGET Highlights (in destination files) ---
    for (const target of sorted) {
        const isPrimary = target === this.activeTarget;
        
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

        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.fsPath === targetUri.fsPath) {
                const line = Math.min(target.position.line, editor.document.lineCount - 1);
                const lineRange = editor.document.lineAt(line).range;
                
                // Highlight the line
                editor.setDecorations(this.targetHighlightType, [lineRange]);

                // Show preview for primary only
                if (isPrimary && target.suggestedAction && 'code' in target.suggestedAction && target.suggestedAction.code) {
                    const previewLines = target.suggestedAction.code.split('\n');
                    const firstLinePreview = previewLines[0].trim();
                    
                    if (firstLinePreview) {
                        const previewDecoration = {
                            range: lineRange,
                            renderOptions: {
                                after: {
                                    contentText: `  // Suggested: ${firstLinePreview}${previewLines.length > 1 ? ' ...' : ''}`,
                                }
                            }
                        };
                        editor.setDecorations(this.targetPreviewType, [previewDecoration]);
                    }
                }
            }
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
  public getActiveTarget(): NextEditPrediction | null {
    return this.activeTarget;
  }

  /**
   * Clear all indicators from all editors.
   */
  public clearIndicators(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        editor.setDecorations(this.targetHighlightType, []);
        editor.setDecorations(this.targetPreviewType, []);
        editor.setDecorations(this.sourceBadgeType, []);
    }
  }

  public dispose(): void {
    this.clearIndicators();
    this.targetHighlightType.dispose();
    this.targetPreviewType.dispose();
    this.sourceBadgeType.dispose();
  }
}


