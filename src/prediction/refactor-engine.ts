/**
 * SONEC Autonomous Refactor Engine
 * 
 * Periodically scans the codebase for issues and inconsistencies,
 * proposing multi-file transformations to improve code quality.
 */

import * as vscode from 'vscode';
import { PredictionEngine } from './prediction-engine';
import { ContextEngine } from '../context/context-engine';
import { Logger } from '../core/logger';
import { ConfigManager } from '../core/config';
import { ActionPlan } from '../core/types';

export class AutonomousRefactorEngine implements vscode.Disposable {
  private logger = Logger.getInstance();
  private config = ConfigManager.getInstance();
  private scanTimer: NodeJS.Timeout | null = null;
  private readonly SCAN_INTERVAL = 60_000; // 1 minute
  private predictionEngine: PredictionEngine;
  private contextEngine: ContextEngine;
  private lastRefactorPlan: ActionPlan | null = null;

  constructor(predictionEngine: PredictionEngine, contextEngine: ContextEngine) {
    this.predictionEngine = predictionEngine;
    this.contextEngine = contextEngine;

    // Start periodic scanning
    this.startScanning();
  }

  /**
   * Start the periodic background scanning.
   */
  private startScanning(): void {
    if (this.scanTimer) {clearInterval(this.scanTimer);}
    this.scanTimer = setInterval(() => this.scanAndRefactor(), this.SCAN_INTERVAL);
    this.logger.info('Autonomous Refactor Engine started');
  }

  /**
   * Scan all visible editors and surrounding workspace for issues.
   */
  public async scanAndRefactor(): Promise<void> {
    if (!this.config.getValue('enabled')) {return;}

    const visibleEditors = vscode.window.visibleTextEditors;
    if (visibleEditors.length === 0) {return;}

    const allIssues: string[] = [];
    const targetDocs: vscode.TextDocument[] = [];

    for (const editor of visibleEditors) {
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        if (diagnostics.length > 0) {
            allIssues.push(...diagnostics.map(d => `[\${editor.document.fileName}:L\${d.range.start.line}] \${d.message}`));
            targetDocs.push(editor.document);
        }
    }
    
    // Also check for project-wide inconsistencies if more than one file is open
    if (allIssues.length === 0) {
        this.logger.debug('No immediate issues found, performing architectural consistency check.');
        // Proactive refactoring can still happen here
    }

    this.logger.info(`Autonomous refactor triggered for \${targetDocs.length} files (\${allIssues.length} issues)`);

    try {
        const cts = new vscode.CancellationTokenSource();
        // Use the first editor as the primary context pivot
        const primaryEditor = visibleEditors[0];
        const context = await this.contextEngine.buildContext(primaryEditor.document, primaryEditor.selection.active, cts.token);
        
        const plan = await this.predictionEngine.getTransformation(
            context,
            `Fix the following issues across the open files and ensure architectural consistency: \${allIssues.length > 0 ? allIssues.join(', ') : 'Perform general code quality improvements and refactoring.'}`,
            cts.token
        );

        if (plan && plan.actions.length > 0) {
            this.lastRefactorPlan = plan;
            this.logger.info(`Autonomous refactor plan generated with \${plan.actions.length} actions`);
            
            // Notify via event bus or status bar (implemented in CommandHandlers/PerformanceMonitor)
            vscode.commands.executeCommand('setContext', 'sonec.transformationReady', true);
            
            // Non-intrusive notification
            vscode.window.showInformationMessage(
                `SONEC: Autonomous refactor ready to fix \${diagnostics.length} issues.`,
                'View Changes'
            ).then(selection => {
                if (selection === 'View Changes') {
                    vscode.commands.executeCommand('sonec.showPredictedEdits');
                }
            });
        }
    } catch (err) {
        this.logger.error('Autonomous refactor scan failed', err);
    }
  }

  /**
   * Get the latest refactor plan.
   */
  public getLastPlan(): ActionPlan | null {
    return this.lastRefactorPlan;
  }

  dispose(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
    }
  }
}
