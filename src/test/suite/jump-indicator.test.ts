import * as assert from 'assert';
import * as vscode from 'vscode';
import { JumpIndicatorManager } from '../../ui/jump-indicator';
import { NextEditPrediction } from '../../core/types';

suite('JumpIndicatorManager', () => {
  let manager: JumpIndicatorManager;

  setup(() => {
    manager = new JumpIndicatorManager();
  });

  teardown(() => {
    manager.dispose();
  });

  test('Should initialize without errors', () => {
    assert.ok(manager, 'Manager should be created');
  });

  test('Should have no active target initially', () => {
    assert.strictEqual(manager.hasActiveTarget(), false);
    assert.strictEqual(manager.getActiveTarget(), null);
  });

  test('Should accept null predictions gracefully', () => {
    manager.updateIndicator(null);
    assert.strictEqual(manager.hasActiveTarget(), false);
  });

  test('Should accept empty array gracefully', () => {
    manager.updateIndicator([]);
    assert.strictEqual(manager.hasActiveTarget(), false);
  });

  test('Should set active target from single prediction', () => {
    const pred: NextEditPrediction = {
      file: 'test.ts',
      position: new vscode.Position(10, 0),
      reason: 'Fix syntax error',
      confidence: 0.9,
    };
    manager.updateIndicator(pred);
    assert.strictEqual(manager.hasActiveTarget(), true);
    assert.strictEqual(manager.getActiveTarget()?.file, 'test.ts');
  });

  test('Should pick highest confidence from array', () => {
    const preds: NextEditPrediction[] = [
      {
        file: 'low.ts',
        position: new vscode.Position(5, 0),
        reason: 'Minor suggestion',
        confidence: 0.3,
      },
      {
        file: 'high.ts',
        position: new vscode.Position(10, 0),
        reason: 'Critical fix',
        confidence: 0.95,
      },
    ];
    manager.updateIndicator(preds);
    assert.strictEqual(manager.getActiveTarget()?.file, 'high.ts');
  });

  test('Should clear indicators', () => {
    const pred: NextEditPrediction = {
      file: 'test.ts',
      position: new vscode.Position(10, 0),
      reason: 'Test',
      confidence: 0.8,
    };
    manager.updateIndicator(pred);
    manager.clearIndicators();
    // After clear, the decorations are removed but activeTarget stays
    // (it's cleared on next updateIndicator(null) call)
    assert.ok(true, 'clearIndicators did not throw');
  });

  test('Should handle disposal gracefully', () => {
    manager.dispose();
    // After dispose, updateIndicator should be a no-op
    manager.updateIndicator({
      file: 'test.ts',
      position: new vscode.Position(0, 0),
      reason: 'Test',
      confidence: 0.5,
    });
    assert.ok(true, 'Operations after dispose did not throw');
  });
});
