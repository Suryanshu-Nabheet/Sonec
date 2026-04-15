/**
 * SONEC Semantic Resolver
 * 
 * Performs cross-file AST resolution to find real signatures of imported symbols.
 * This turns "static context" into "deep architectural context".
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

export class SemanticResolver {
  private logger = Logger.getInstance();

  /**
   * Resolves the definition and signature of symbols imported in the current file
   */
  async resolveImportSignatures(
    document: vscode.TextDocument,
    imports: any[],
    token: vscode.CancellationToken
  ): Promise<string[]> {
    // Limit to top 5 imports and resolve in PARALLEL for extreme speed
    const activeImports = imports.slice(0, 5);

    const tasks = activeImports.map(async (imp) => {
      if (token.isCancellationRequested) return null;

      try {
        const searchPos = this.findImportPosition(document, imp.moduleName);
        if (!searchPos) return null;

        const definitions = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
          'vscode.executeDefinitionProvider',
          document.uri,
          searchPos
        );

        if (!definitions || definitions.length === 0) return null;

        const def = definitions[0];
        const uri = 'uri' in def ? def.uri : def.targetUri;
        const range = 'range' in def ? def.range : def.targetRange;

        const defDoc = await vscode.workspace.openTextDocument(uri);
        const signature = this.extractSignature(defDoc, range);
        
        if (signature) {
          const relPath = vscode.workspace.asRelativePath(uri);
          return `// From ${relPath}:\n${signature}`;
        }
      } catch {
        return null;
      }
      return null;
    });

    const results = await Promise.all(tasks);
    return results.filter((r): r is string => r !== null);
  }

  private findImportPosition(doc: vscode.TextDocument, moduleName: string): vscode.Position | null {
    const text = doc.getText();
    const index = text.indexOf(moduleName);
    if (index === -1) return null;
    return doc.positionAt(index);
  }

  private extractSignature(doc: vscode.TextDocument, range: vscode.Range): string {
    const startLine = range.start.line;
    const endLine = Math.min(doc.lineCount - 1, startLine + 15);
    
    let text = '';
    for (let i = startLine; i <= endLine; i++) {
      const line = doc.lineAt(i).text;
      text += line + '\n';
      if (i > startLine && (line.includes('}') || line.includes('export'))) {
        if (line.trim() === '}' || line.trim() === '};') break;
      }
    }
    return text.trim();
  }
}
