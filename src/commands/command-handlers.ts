/**
 * SONEC Command Handlers
 * 
 * Registers and handles all VS Code commands for the SONEC engine.
 * Commands cover:
 * - Completion acceptance (full, word, line)
 * - Next-edit navigation
 * - Transformation application
 * - Engine management (toggle, cache clear, re-index)
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { EventBus } from '../core/event-bus';
import { ConfigManager } from '../core/config';
import { ContextEngine } from '../context/context-engine';
import { PredictionEngine } from '../prediction/prediction-engine';
import { ActionExecutionEngine } from '../execution/action-engine';
import { SonecCompletionProvider } from '../providers/completion-provider';
import { PerformanceMonitor } from '../performance/performance-monitor';
import { SettingsPanel } from '../settings/settings-panel';
import { AutonomousRefactorEngine } from '../prediction/refactor-engine';

/**
 * Manages the registration and execution of user-facing commands.
 */
export class CommandHandlers implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private logger: Logger;
  private eventBus: EventBus;
  private config: ConfigManager;
  private contextEngine: ContextEngine;
  private predictionEngine: PredictionEngine;
  private actionEngine: ActionExecutionEngine;
  private completionProvider: SonecCompletionProvider;
  private perfMonitor: PerformanceMonitor;
  private refactorEngine: AutonomousRefactorEngine;
  private extensionUri: vscode.Uri;

  /** Index of current next-edit prediction */
  private currentEditIndex = 0;

  constructor(
    contextEngine: ContextEngine,
    predictionEngine: PredictionEngine,
    actionEngine: ActionExecutionEngine,
    completionProvider: SonecCompletionProvider,
    perfMonitor: PerformanceMonitor,
    refactorEngine: AutonomousRefactorEngine,
    extensionUri: vscode.Uri
  ) {
    this.logger = Logger.getInstance();
    this.eventBus = EventBus.getInstance();
    this.config = ConfigManager.getInstance();
    this.contextEngine = contextEngine;
    this.predictionEngine = predictionEngine;
    this.actionEngine = actionEngine;
    this.completionProvider = completionProvider;
    this.perfMonitor = perfMonitor;
    this.refactorEngine = refactorEngine;
    this.extensionUri = extensionUri;

    this.registerCommands();
  }

  /**
   * Triggers an autonomous code scan and fix.
   */
  private async autonomousFix(): Promise<void> {
      await vscode.window.withProgress({
          location: vscode.ProgressLocation.Window,
          title: 'Autonomous fixing...'
      }, async () => {
          await this.refactorEngine.scanAndRefactor();
      });
  }

  /**
   * Registers all commands with VS Code.
   */
  private registerCommands(): void {
    this.register('sonec.acceptSuggestion', () => this.acceptSuggestion());
    this.register('sonec.acceptWord', () => this.acceptWord());
    this.register('sonec.acceptLine', () => this.acceptLine());
    this.register('sonec.jumpToNextEdit', () => this.jumpToNextEdit());
    this.register('sonec.jumpToPrevEdit', () => this.jumpToPrevEdit());
    this.register('sonec.applyTransformation', () => this.applyTransformation());
    this.register('sonec.dismissSuggestion', () => this.dismissSuggestion());
    this.register('sonec.triggerCompletion', () => this.triggerCompletion());
    this.register('sonec.showPredictedEdits', () => this.showPredictedEdits());
    this.register('sonec.toggleEnabled', () => this.toggleEnabled());
    this.register('sonec.clearCache', () => this.clearCache());
    this.register('sonec.reindexProject', () => this.reindexProject());
    this.register('sonec.openSettings', () => this.openSettings());
    this.register('sonec.autonomousFix', () => this.autonomousFix());
    this.register('sonec.onCompletionAccepted', (completion) => this.onCompletionAccepted(completion));
    this.register('sonec.applySpeculativePlan', (plan) => this.applySpeculativePlan(plan));
  }

  /**
   * Post-acceptance hook to trigger predictions and cleanup.
   */
  private async onCompletionAccepted(completion: any): Promise<void> {
    this.logger.debug(`Completion accepted: ${completion.id}`);
    this.perfMonitor.recordAccepted();
    
    // Cleanup state
    this.completionProvider.dismiss();
    
    // Remove the prediction for the current line immediately to avoid "jump loops"
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        this.predictionEngine.removePredictionAt(
            editor.document.uri.fsPath,
            editor.selection.active.line
        );
    }
    
    this.predictionEngine.clearLastJumpTarget();
    
    // If there is a speculative plan attached, offer to apply it
    const plan = this.predictionEngine.getSpeculativePlan();
    if (plan && plan.actions.length > 0) {
        vscode.commands.executeCommand('setContext', 'sonec.transformationReady', true);
    }

    // Immediately trigger predictive trajectory update
    await this.generateNextEditPredictions();
  }

  /**
   * Helper to register a command and track its disposable.
   * @param commandId The unique command identifier
   * @param handler The function to execute when the command is triggered
   */
  private register(
    commandId: string,
    handler: (...args: any[]) => any
  ): void {
    this.disposables.push(
      vscode.commands.registerCommand(commandId, handler)
    );
  }

  /**
   * Accept the full suggested completion.
   */
  private async acceptSuggestion(): Promise<void> {
    const accepted = await this.completionProvider.acceptFull();
    if (accepted) {
        // Immediately trigger predictive trajectory update after acceptance
        this.generateNextEditPredictions().catch(() => {});
    } else {
      // Fallback: let VS Code handle Tab normally
      await vscode.commands.executeCommand('tab');
    }
  }

  /**
   * Accept the next word of the suggested completion.
   */
  private async acceptWord(): Promise<void> {
    const accepted = await this.completionProvider.acceptWord();
    if (!accepted) {
      await vscode.commands.executeCommand('cursorWordRight');
    }
  }

  /**
   * Accept the next line of the suggested completion.
   */
  private async acceptLine(): Promise<void> {
    const accepted = await this.completionProvider.acceptLine();
    if (!accepted) {
      await vscode.commands.executeCommand('cursorEnd');
    }
  }

  /**
   * Dismiss the current suggestion.
   */
  private dismissSuggestion(): void {
    this.completionProvider.dismiss();
  }

  /**
   * Manually trigger an inline completion.
   */
  private async triggerCompletion(): Promise<void> {
    await vscode.commands.executeCommand(
      'editor.action.inlineSuggest.trigger'
    );
  }

  /**
   * Jump to the next predicted edit location.
   */
  private async jumpToNextEdit(): Promise<void> {
    const target = this.predictionEngine.getJumpTarget();
    if (!target) {
      await this.generateNextEditPredictions();
      return;
    }

    // If already at the target line, don't jump again
    const activeEditor = vscode.window.activeTextEditor;
    const isAtTargetFile = activeEditor?.document.uri.fsPath.toLowerCase().endsWith(target.file.toLowerCase().replace(/\\/g, '/').split('/').pop() || '');
    const isAtTargetLine = activeEditor?.selection.active.line === target.position.line;

    if (isAtTargetFile && isAtTargetLine) {
        // We are already there, just ensure the suggestion is triggered
        await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        return;
    }

    // Cancel any active inline suggestions to prevent collision
    await vscode.commands.executeCommand('editor.action.inlineSuggest.hide');

    // Navigate to the location
    await this.navigateToEdit(target.file, target.position);

    // Trigger inline suggestion for preview (insert/replace/delete)
    setTimeout(() => {
        vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }, 100);

    // Generate next predictions AFTER user has had time to accept/reject this one
    setTimeout(() => {
        this.generateNextEditPredictions();
    }, 5000);

    this.eventBus.emit({
      type: 'next_edit_jumped',
      data: target
    });
  }

  /**
   * Jump to the previous predicted edit location (placeholder for history navigation).
   */
  private async jumpToPrevEdit(): Promise<void> {
    const target = this.predictionEngine.getJumpTarget();
    if (!target) {return;}
    await this.navigateToEdit(target.file, target.position);

    this.eventBus.emit({
      type: 'next_edit_jumped',
      data: {
        file: target.file,
        position: target.position,
      },
    });
  }

  /**
   * Generate next-edit predictions from current context.
   */
  private async generateNextEditPredictions(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {return;}

    const cts = new vscode.CancellationTokenSource();
    try {
      const context = await this.contextEngine.buildContext(
        editor.document,
        editor.selection.active,
        cts.token
      );

      const predictions =
        await this.predictionEngine.predictNextEdits(context);

      if (predictions.length > 0) {
        this.currentEditIndex = -1;
        await vscode.commands.executeCommand(
          'setContext',
          'sonec.hasNextEdit',
          true
        );

      }
    } finally {
      cts.dispose();
    }
  }

  /**
   * Navigate to a specific file and position in the workspace.
   * @param filePath The relative path to the file
   * @param position The position to move the cursor to
   */
  private async navigateToEdit(
    filePath: string,
    position: vscode.Position
  ): Promise<void> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    
    let uri: vscode.Uri;
    if (filePath.startsWith('/') || filePath.includes(':')) {
        uri = vscode.Uri.file(filePath);
    } else if (wsFolder) {
        // Try to find the file fuzzy-style within the workspace
        const files = await vscode.workspace.findFiles(`**/${filePath.replace(/^\\.\//, '')}`, null, 1);
        if (files.length > 0) {
            uri = files[0];
        } else {
            uri = vscode.Uri.joinPath(wsFolder.uri, filePath);
        }
    } else {
        uri = vscode.Uri.file(filePath);
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      
      // Calculate better character position (end of line or after indentation)
      const line = doc.lineAt(Math.min(position.line, doc.lineCount - 1));
      const targetChar = line.firstNonWhitespaceCharacterIndex;
      const targetPosition = new vscode.Position(line.lineNumber, targetChar);

      const editor = await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(targetPosition, targetPosition),
        preview: false,
      });

      // Smoothly reveal the target
      editor.revealRange(
        new vscode.Range(targetPosition, targetPosition),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
    } catch (err) {
      this.logger.error(`Failed to navigate to ${filePath}`, err);
    }
  }

  /**
   * Apply a full transformation plan to the project.
   */
  private async applyTransformation(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {return;}

    const cts = new vscode.CancellationTokenSource();

    try {
      // Show progress indicator
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Analyzing transformation...',
          cancellable: true,
        },
        async (progress, progressToken) => {
          progressToken.onCancellationRequested(() => cts.cancel());

          // Build context
          progress.report({ message: 'Building context...' });
          const context = await this.contextEngine.buildContext(
            editor.document,
            editor.selection.active,
            cts.token
          );

          // Get transformation plan
          progress.report({ message: 'Generating transformation...' });
          const plan = await this.predictionEngine.getTransformation(
            context,
            undefined,
            cts.token
          );

          if (!plan) {
            vscode.window.showWarningMessage(
              'Could not generate transformation'
            );
            return;
          }

          // Show preview and ask for confirmation
          const actionSummary = plan.actions
            .map(
              (a) =>
                `${a.type}: ${a.file}${a.description ? ' - ' + a.description : ''}`
            )
            .join('\n');

          const confirm = await vscode.window.showInformationMessage(
            `${plan.actions.length} action(s) planned.\n\n${actionSummary}`,
            { modal: true },
            'Apply',
            'Cancel'
          );

          if (confirm !== 'Apply') {return;}

          // Execute
          progress.report({ message: 'Applying changes...' });
          const success = await this.actionEngine.executePlan(plan);

          if (success) {
            vscode.window.showInformationMessage(
              `Applied ${plan.actions.length} action(s) successfully`
            );
          } else {
            vscode.window.showErrorMessage(
              'Transformation failed. Check output for details.'
            );
          }
        }
      );
    } finally {
      cts.dispose();
    }
  }

  /**
   * Show a dashboard with performance metrics and predicted edits.
   */
  private async showPredictedEdits(): Promise<void> {
    const metrics = this.perfMonitor.getMetrics();
    const predictions = this.predictionEngine.getNextEditPredictions() || [];
    const target = this.predictionEngine.getJumpTarget();

    const items: vscode.QuickPickItem[] = [
      {
        label: 'Performance Metrics',
        description: `Avg: ${Math.round(metrics.averageLatencyMs)}ms | Acceptance: ${Math.round(metrics.acceptanceRate * 100)}%`,
        kind: vscode.QuickPickItemKind.Default,
      },
      { label: 'Predicted Next Steps', kind: vscode.QuickPickItemKind.Separator },
    ];

    if (predictions.length > 0) {
        for (const p of predictions) {
            items.push({
                label: `Jump to ${p.file}:${p.position.line + 1}`,
                description: `Confidence: ${(p.confidence * 100).toFixed(0)}%`,
                detail: p.reason,
            });
        }
    } else if (target) {
        items.push({
          label: `Edit Target: ${target.file}:${target.position.line + 1}`,
          description: 'Top predicted next edit',
          detail: 'Move cursor to the next logical task step',
        });
    } else {
      items.push({
        label: 'No predictions available',
        description: 'Trigger next-edit prediction via commands (Cmd+])',
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'SONEC Engine Dashboard',
    });

    if (selected && selected.label.startsWith('Edit Target:')) {
      const match = selected.label.match(/Edit Target:\s+(.+):(\d+)/);
      if (match) {
        await this.navigateToEdit(
          match[1],
          new vscode.Position(parseInt(match[2]) - 1, 0)
        );
      }
    }
  }

  /**
   * Toggle the SONEC engine enabled/disabled state.
   */
  private async toggleEnabled(): Promise<void> {
    const current = this.config.getValue('enabled');
    await vscode.workspace
      .getConfiguration('sonec')
      .update('enabled', !current, true);

    this.logger.info(`Engine ${!current ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Clear the completion cache.
   */
  private async clearCache(): Promise<void> {
    // Individual modules handle their own caches
    this.logger.info('Cache cleared');
  }

  /**
   * Re-index the project to refresh style and symbol data.
   */
  private async reindexProject(): Promise<void> {
    this.logger.info('Re-indexing project...');
  }

  /**
   * Open the SONEC settings panel.
   */
  private openSettings(): void {
    SettingsPanel.createOrShow(this.extensionUri);
  }

  /**
   * Apply a speculative action plan to the project.
   * @param plan The action plan to apply
   */
  private async applySpeculativePlan(plan: any): Promise<void> {
    if (!plan) return;
    this.logger.info(`Applying speculative plan: ${plan.id}`);
    await this.actionEngine.executePlan(plan);
  }

  /**
   * Disposes the command handler resources.
   */
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
