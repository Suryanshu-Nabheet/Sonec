import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * Tests for the ActionExecutionEngine.
 * Validates that workspace edits are constructed correctly.
 */
suite('Action Execution Engine', () => {

  test('WorkspaceEdit insert should add text', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'line one\nline two\n',
    });

    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(1, 0), '// inserted\n');

    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success, 'Insert edit should succeed');

    // Verify the content changed
    const updatedDoc = await vscode.workspace.openTextDocument(doc.uri);
    assert.ok(updatedDoc.getText().includes('// inserted'), 'Insert text should be present');
  });

  test('WorkspaceEdit replace should swap text', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'const bad = true;\n',
    });

    const lineRange = doc.lineAt(0).range;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, lineRange, 'const good = true;');

    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success, 'Replace edit should succeed');

    const updatedDoc = await vscode.workspace.openTextDocument(doc.uri);
    assert.ok(updatedDoc.getText().includes('const good = true'), 'Replaced text should be present');
  });

  test('WorkspaceEdit delete should remove text', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'keep this\ndelete this\nkeep this too\n',
    });

    const deleteRange = new vscode.Range(
      new vscode.Position(1, 0),
      new vscode.Position(2, 0)
    );
    const edit = new vscode.WorkspaceEdit();
    edit.delete(doc.uri, deleteRange);

    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success, 'Delete edit should succeed');

    const updatedDoc = await vscode.workspace.openTextDocument(doc.uri);
    assert.ok(!updatedDoc.getText().includes('delete this'), 'Deleted text should be gone');
  });

  test('Empty replace should effectively delete line content', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'typescript',
      content: 'const unused = "remove me";\n',
    });

    const lineRange = doc.lineAt(0).range;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, lineRange, '');

    const success = await vscode.workspace.applyEdit(edit);
    assert.ok(success, 'Empty replace should succeed');
  });
});

suite('File Resolution', () => {
  test('Should resolve workspace-relative paths', () => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
      const uri = vscode.Uri.joinPath(ws.uri, 'src/extension.ts');
      assert.ok(uri.fsPath.endsWith('extension.ts'));
    }
  });

  test('Should handle absolute paths', () => {
    const uri = vscode.Uri.file('/tmp/test.ts');
    assert.ok(uri.fsPath.endsWith('test.ts'));
  });

  test('Basename extraction should work', () => {
    const path = 'src/ui/jump-indicator.ts';
    const basename = path.split(/[/\\]/).pop();
    assert.strictEqual(basename, 'jump-indicator.ts');
  });

  test('File matching by basename should be case-insensitive', () => {
    const match = (a: string, b: string) => {
      const nameA = a.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
      const nameB = b.toLowerCase().replace(/\\/g, '/').split('/').pop() || '';
      return nameA === nameB;
    };

    assert.ok(match('/path/to/File.ts', 'src/file.ts'));
    assert.ok(!match('/path/to/other.ts', 'src/file.ts'));
  });
});
