/**
 * SONEC — Structured Omniscient Neural Editor & Compiler
 * 
 * Extension Entry Point
 * 
 * This is the main activation point for the SONEC VS Code extension.
 * It initializes all subsystems in the correct dependency order:
 * 
 *   1. Core (Logger, Config, EventBus)
 *   2. Context Engine
 *   3. Model Layer
 *   4. Prediction Engine  
 *   5. Action Execution Engine
 *   6. Completion Provider
 *   7. Command Handlers
 *   8. Performance Monitor
 *   9. Event Listeners
 * 
 * Architecture Overview:
 * ┌──────────────────────────────────────────────────────────────┐
 * │                      VS Code Extension                       │
 * │  ┌────────────────┐  ┌──────────────────────────────────┐    │
 * │  │ Completion     │  │ Command Handlers                 │    │
 * │  │ Provider       │  │ (accept, jump, transform, etc.)  │    │
 * │  └───────┬────────┘  └────────────────┬─────────────────┘    │
 * │          │                             │                     │
 * │  ┌───────▼─────────────────────────────▼─────────────────┐   │
 * │  │              Prediction Engine                        │   │
 * │  │  (completion generation, transformation planning,     │   │
 * │  │   next-edit prediction)                               │   │
 * │  └───────┬───────────────────────────────┬───────────────┘   │
 * │          │                               │                   │
 * │  ┌───────▼────────────┐  ┌──────────────▼─────────────-───┐  │
 * │  │  Context Engine    │  │  Model Layer                   │  │
 * │  │  ┌──────────────-┐ │  │   ┌─────────┐ ┌────────────┐   │  │
 * │  │  │Symbol Analyzer│ │  │   │ OpenAI  │ │ Anthropic  │   │  │
 * │  │  │Import Analyzer│ │  │   │ Ollama  │ │ Custom     │   │  │
 * │  │  │Git Analyzer   │ │  │   └─────────┘ └────────────┘   │  │
 * │  │  │Style Analyzer │ │  │  ┌──────────────────────┐      │  │
 * │  │  │Context Ranker │ │  │  │ Prompt Builder       │      │  │
 * │  │  └─────────────-─┘ │  │  └──────────────────────┘      │  │
 * │  └────────────────────┘  └───────────────────────────-────┘  │
 * │          │                               │                   │
 * │  ┌───────▼───────────────────────────────▼──────────────┐    │
 * │  │              Action Execution Engine                 │    │
 * │  │  (atomic edits, undo stack, multi-file apply)        │    │
 * │  └──────────────────────────────────────────────────────┘    │
 * │                                                              │
 * │  ┌─────────────────────────────────────────────────────────┐ │
 * │  │  Performance Monitor + Cache + Event Bus                │ │
 * │  └─────────────────────────────────────────────────────────┘ │
 * └──────────────────────────────────────────────────────────────┘
 */

import * as vscode from 'vscode';
import { ConfigManager } from './core/config';
import { Logger } from './core/logger';
import { EventBus } from './core/event-bus';
import { ContextEngine } from './context/context-engine';
import { ModelLayer } from './models/model-layer';
import { PredictionEngine } from './prediction/prediction-engine';
import { ActionExecutionEngine } from './execution/action-engine';
import { SonecCompletionProvider } from './providers/completion-provider';
import { CommandHandlers } from './commands/command-handlers';
import { PerformanceMonitor } from './performance/performance-monitor';
import { SettingsPanel } from './settings/settings-panel';
import { AutonomousRefactorEngine } from './prediction/refactor-engine';
import { JumpIndicatorManager } from './ui/jump-indicator';

/** All disposables created during activation */
let disposables: vscode.Disposable[] = [];

/**
 * Extension activation — called when VS Code loads SONEC
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('SONEC: Activating...');
  // ─── 1. Initialize Core Singletons ───
  const logger = Logger.getInstance();
  const config = ConfigManager.getInstance();
  const eventBus = EventBus.getInstance();

  logger.setLevel(config.getValue('logLevel'));
  logger.info('SONEC Engine activating...');

  // Track config changes to update logger level
  disposables.push(
    config.onConfigChange((changed) => {
      if (changed.logLevel) {
        logger.setLevel(changed.logLevel);
      }
    })
  );

  // ─── 2. Initialize Context Engine ───
  const contextEngine = new ContextEngine();
  disposables.push(contextEngine);

  // ─── 3. Initialize Model Layer ───
  const modelLayer = new ModelLayer();
  disposables.push(modelLayer);

  // ─── 4. Initialize Prediction Engine ───
  const predictionEngine = new PredictionEngine(modelLayer);
  disposables.push(predictionEngine);

  // ─── 5. Initialize Action Execution Engine ───
  const actionEngine = new ActionExecutionEngine();
  disposables.push(actionEngine);

  // ─── 6. Initialize Performance Monitor ───
  const perfMonitor = new PerformanceMonitor();
  disposables.push(perfMonitor);

  // ─── 7. Initialize Autonomous Refactor Engine ───
  const refactorEngine = new AutonomousRefactorEngine(predictionEngine, contextEngine);
  disposables.push(refactorEngine);

  // ─── 8. Initialize UI Components ───
  const jumpIndicator = new JumpIndicatorManager();
  disposables.push(jumpIndicator);

  // ─── 9. Initialize Completion Provider ───
  const completionProvider = new SonecCompletionProvider(
    contextEngine,
    predictionEngine,
    perfMonitor
  );

  // Register as inline completion provider for ALL languages
  const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    completionProvider
  );
  disposables.push(providerDisposable);

  // ─── 8. Initialize Command Handlers ───
  const commandHandlers = new CommandHandlers(
    contextEngine,
    predictionEngine,
    actionEngine,
    completionProvider,
    perfMonitor,
    refactorEngine,
    context.extensionUri
  );
  disposables.push(commandHandlers);

  // Register status check command
  disposables.push(vscode.commands.registerCommand('sonec.checkStatus', async () => {
    const status = await modelLayer.checkStatus();
    if (status.ok) {
        vscode.window.showInformationMessage(`SONEC Status: OK. Provider: ${status.provider}, Model: ${status.model}`);
    } else {
        vscode.window.showErrorMessage(`SONEC Status: ERROR. ${status.error}`);
    }
  }));

  // ─── 9. Set up Domain Event Listeners ───
  EventBus.getInstance().on('next_edits_updated', (event: any) => {
      const topPrediction = predictionEngine.getJumpTarget();
      jumpIndicator.updateIndicator(topPrediction);
      vscode.commands.executeCommand('setContext', 'sonec.hasNextEdit', !!topPrediction);
  });

  EventBus.getInstance().on('action_applied', (event: any) => {
      jumpIndicator.clearIndicators();
      vscode.commands.executeCommand('setContext', 'sonec.hasNextEdit', false);
  });

  // ─── 10. Set up Document Event Listeners ───
  setupDocumentListeners(contextEngine, predictionEngine);

  // ─── 10. Set Initial Context Keys ───
  vscode.commands.executeCommand('setContext', 'sonec.hasNextEdit', false);
  vscode.commands.executeCommand('setContext', 'sonec.hasPrevEdit', false);
  vscode.commands.executeCommand('setContext', 'sonec.transformationReady', false);

  // ─── Register all disposables with context ───
  disposables.push(logger, config, eventBus);
  context.subscriptions.push(...disposables);

  // ─── Ready ───
  const readyMsg = config.isReady()
    ? `SONEC Engine activated. Provider: ${config.getValue('provider')}, Model: ${config.getValue('model')}`
    : 'SONEC Engine activated. Configure API key in settings to enable completions.';

  logger.info(readyMsg);

  if (!config.isReady()) {
    const openSettings = 'Open Settings';
    vscode.window.showInformationMessage(
      'SONEC: Configure your API key to enable autonomous completions.',
      openSettings
    ).then((selected) => {
      if (selected === openSettings) {
        SettingsPanel.createOrShow(context.extensionUri);
      }
    });
  }
}

/**
 * Extension deactivation — cleanup
 */
export function deactivate(): void {
  const logger = Logger.getInstance();
  logger.info('SONEC Engine deactivating...');

  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      // Best effort cleanup
    }
  }
  disposables = [];
}

/**
 * Set up listeners for document events to maintain context freshness
 */
function setupDocumentListeners(
  contextEngine: ContextEngine,
  _predictionEngine: PredictionEngine
): void {
  const logger = Logger.getInstance();

  // When a file is saved, invalidate related caches
  disposables.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      logger.debug(`File saved: ${document.fileName}`);
    })
  );

  // When a file is opened, preload context
  disposables.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      logger.debug(`File opened: ${document.fileName}`);
    })
  );

  // When active editor changes, prepare context
  disposables.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        logger.debug(`Active editor changed: ${editor.document.fileName}`);

        // Pre-warm context for the new file
        const cts = new vscode.CancellationTokenSource();
        setTimeout(() => cts.cancel(), 3000);

        contextEngine
          .buildContext(editor.document, editor.selection.active, cts.token)
          .catch(() => {/* Pre-warming is non-critical */})
          .finally(() => cts.dispose());
      }
    })
  );

  // Track cursor movement for proactive suggestions and trajectory updates
  let selectionTimer: NodeJS.Timeout | null = null;
  disposables.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (selectionTimer) {
        clearTimeout(selectionTimer);
      }

      const config = ConfigManager.getInstance();
      if (!config.getValue('enabled')) {return;}

      // Trigger proactive completions and trajectory updates after a short idle period
      const debounceMs = config.getValue('debounceMs');
      selectionTimer = setTimeout(async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === event.textEditor.document && editor.selection.isEmpty) {
          vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
          
          // Background predictive pathing
          try {
              const cts = new vscode.CancellationTokenSource();
              setTimeout(() => cts.cancel(), 5000);
              const context = await contextEngine.buildContext(editor.document, editor.selection.active, cts.token);
              await _predictionEngine.predictNextEdits(context, cts.token);
              cts.dispose();
          } catch {
              // Non-blocking
          }
        }
      }, debounceMs);
    })
  );
}
