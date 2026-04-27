/**
 * AutoCode Definition Tool
 * 
 * Follows symbols to their definitions across the project to provide
 * the AI with deep type context and interface signatures.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

export interface SymbolDefinition {
  name: string;
  kind: string;
  signature: string;
  location: string;
  docString?: string;
}

export class DefinitionTool {
  private static instance: DefinitionTool;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): DefinitionTool {
    if (!DefinitionTool.instance) {
      DefinitionTool.instance = new DefinitionTool();
    }
    return DefinitionTool.instance;
  }

  /**
   * Resolves the definition of a symbol at a given position.
   */
  public async resolveDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<SymbolDefinition | null> {
    try {
      const definitions = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        position
      );

      if (!definitions || definitions.length === 0) return null;

      const def = definitions[0];
      const uri = 'uri' in def ? def.uri : def.targetUri;
      const range = 'range' in def ? def.range : def.targetRange;

      const defDoc = await vscode.workspace.openTextDocument(uri);
      const signature = defDoc.getText(range);
      const name = document.getText(document.getWordRangeAtPosition(position));

      // Get surrounding lines for context (e.g. for interface/class)
      const fullSignatureRange = new vscode.Range(
        range.start.line, 0,
        Math.min(range.start.line + 10, defDoc.lineCount - 1), 0
      );
      const fullSignature = defDoc.getText(fullSignatureRange);

      return {
        name,
        kind: 'Definition',
        signature: fullSignature,
        location: vscode.workspace.asRelativePath(uri),
      };
    } catch (err) {
      this.logger.error('Failed to resolve definition', err);
      return null;
    }
  }

  /**
   * Formats symbol definitions for the AI.
   */
  public formatForPrompt(definitions: SymbolDefinition[]): string {
    if (definitions.length === 0) return '';

    const content = definitions.map(d => 
      `--- ${d.name} (${d.location}) ---\n${d.signature}`
    ).join('\n\n');

    return `<symbol_definitions>\n${content}\n</symbol_definitions>`;
  }
}
