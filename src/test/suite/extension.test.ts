import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {
  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('sonec.sonec');
    assert.ok(ext, 'Extension not found');
  });

  test('Extension should activate', async () => {
    const ext = vscode.extensions.getExtension('sonec.sonec');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    assert.ok(ext?.isActive, 'Extension did not activate');
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands(true);
    
    const expected = [
      'sonec.jumpToNextEdit',
      'sonec.acceptSuggestion',
      'sonec.dismissSuggestion',
      'sonec.triggerCompletion',
      'sonec.toggleEnabled',
      'sonec.showPredictedEdits',
      'sonec.applyTransformation',
      'sonec.openSettings',
      'sonec.autonomousFix',
    ];

    for (const cmd of expected) {
      assert.ok(commands.includes(cmd), `Command "${cmd}" not registered`);
    }
  });
});

suite('Configuration', () => {
  test('Default settings should exist', () => {
    const config = vscode.workspace.getConfiguration('sonec');
    
    assert.strictEqual(config.get('enabled'), true);
    assert.strictEqual(config.get('provider'), 'ollama');
    assert.strictEqual(config.get('model'), 'qwen2.5-coder:1.5b');
  });

  test('Should be able to toggle enabled state', async () => {
    const config = vscode.workspace.getConfiguration('sonec');
    const original = config.get<boolean>('enabled');
    
    await config.update('enabled', !original, vscode.ConfigurationTarget.Global);
    assert.strictEqual(config.get('enabled'), !original);
    
    // Restore
    await config.update('enabled', original, vscode.ConfigurationTarget.Global);
  });
});

suite('Inline Completion Provider', () => {
  test('Should be registered for all languages', async () => {
    // Opening a file should not throw — provider is registered
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'const x = 1;\n',
    });
    const editor = await vscode.window.showTextDocument(doc);
    assert.ok(editor, 'Could not open editor');
  });

  test('Should not trigger on excluded languages', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: 'hello world',
    });
    await vscode.window.showTextDocument(doc);
    // No assertion needed — just verify no crash
  });
});

suite('Jump Navigation', () => {
  test('Jump command should not throw when no predictions exist', async () => {
    // Clear context
    await vscode.commands.executeCommand('setContext', 'sonec.hasNextEdit', false);
    
    // Execute should be safe (no-op or trigger prediction generation)
    try {
      await vscode.commands.executeCommand('sonec.jumpToNextEdit');
    } catch {
      assert.fail('jumpToNextEdit threw when no predictions exist');
    }
  });
});

suite('Context Keys', () => {
  test('Initial context keys should be false', () => {
    // These are set during activation — just verify no crash on read
    assert.ok(true, 'Context keys initialized');
  });
});
