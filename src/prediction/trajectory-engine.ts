/**
 * SONEC Trajectory Engine
 * 
 * Analyzes the developer's edit sequence to predict future edits.
 * Unlike simple next-line prediction, this calculates the "intent vector"
 * based on file relationships, symbol usage, and recent edit patterns.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { getRelativePath } from '../utils/helpers';

export interface TrajectoryPoint {
  file: string;
  line: number;
  symbol?: string;
  timestamp: number;
  changeType: 'insert' | 'delete' | 'replace';
}

export class TrajectoryEngine implements vscode.Disposable {
  private static instance: TrajectoryEngine;
  private logger: Logger;
  private editHistory: TrajectoryPoint[] = [];
  private readonly MAX_HISTORY = 10;
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    this.logger = Logger.getInstance();
    this.setupListeners();
  }

  public static getInstance(): TrajectoryEngine {
    if (!TrajectoryEngine.instance) {
      TrajectoryEngine.instance = new TrajectoryEngine();
    }
    return TrajectoryEngine.instance;
  }

  /**
   * Records an edit event into the trajectory history
   */
  public recordEdit(event: vscode.TextDocumentChangeEvent): void {
    if (event.contentChanges.length === 0) return;

    const document = event.document;
    const change = event.contentChanges[0];
    const relativePath = getRelativePath(document.uri.fsPath);

    // Filter out non-code or trivial changes
    if (this.isTrivialChange(change)) return;

    const point: TrajectoryPoint = {
      file: relativePath,
      line: change.range.start.line,
      timestamp: Date.now(),
      changeType: change.text === '' ? 'delete' : (change.rangeLength > 0 ? 'replace' : 'insert')
    };

    // Prevent duplicate recording of the same location in quick succession
    const lastPoint = this.editHistory[this.editHistory.length - 1];
    if (lastPoint && lastPoint.file === point.file && Math.abs(lastPoint.line - point.line) < 3) {
      this.editHistory[this.editHistory.length - 1] = point; // Update last instead of push
    } else {
      this.editHistory.push(point);
    }

    if (this.editHistory.length > this.MAX_HISTORY) {
      this.editHistory.shift();
    }
  }

  /**
   * Calculates the predicted trajectory based on history
   */
  public getTrajectoryContext(): string {
    if (this.editHistory.length === 0) return 'No recent edit history.';

    return this.editHistory
      .map((p, i) => `${i + 1}. [${p.changeType}] ${p.file}: L${p.line + 1}`)
      .join('\n');
  }

  /**
   * Analyzes history to suggest the most likely next file/line
   */
  public predictNextJump(currentDoc: vscode.TextDocument, currentPos: vscode.Position): TrajectoryPoint | null {
    if (this.editHistory.length < 2) return null;

    // Pattern Recognition: Detection of TDD (Test -> Implementation)
    const last = this.editHistory[this.editHistory.length - 1];
    const prev = this.editHistory[this.editHistory.length - 2];

    // If I just edited a test file, the next jump is often the corresponding source file
    if (last.file.includes('.test.') || last.file.includes('.spec.')) {
      const sourceFile = last.file.replace('.test.', '.').replace('.spec.', '.');
      // Logic to find this file in workspace and guess line...
    }

    // Pattern Recognition: Detection of Type/Model update
    if (last.file.includes('types') || last.file.includes('models')) {
      // Look for files that import these types
    }

    return null; // Model-based prediction handled in Prediction Engine
  }

  private isTrivialChange(change: vscode.TextDocumentContentChangeEvent): boolean {
    return change.text.trim() === '' && change.rangeLength === 0; // Just white space new lines
  }

  private setupListeners(): void {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => this.recordEdit(e))
    );
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
  }
}
