/**
 * AutoCode Project Graph Tool
 * 
 * Maps complex relationships between files based on project structure,
 * naming patterns, and shared symbols.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';

export interface FileRelation {
  path: string;
  type: 'sibling' | 'cousin' | 'related_name' | 'shared_folder';
  score: number;
}

export class ProjectGraphTool {
  private static instance: ProjectGraphTool;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): ProjectGraphTool {
    if (!ProjectGraphTool.instance) {
      ProjectGraphTool.instance = new ProjectGraphTool();
    }
    return ProjectGraphTool.instance;
  }

  /**
   * Finds files related to the current document through non-obvious patterns.
   */
  public async findRelatedFiles(document: vscode.TextDocument): Promise<FileRelation[]> {
    const relations: FileRelation[] = [];
    const currentPath = document.uri.fsPath;
    const currentName = currentPath.split('/').pop() || '';
    const currentBase = currentName.split('.')[0];
    const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));

    // 1. Same directory (Siblings)
    const siblings = await vscode.workspace.findFiles(
      new vscode.RelativePattern(currentDir, '*')
    );
    siblings.forEach(s => {
        if (s.fsPath !== currentPath) {
            relations.push({ path: s.fsPath, type: 'sibling', score: 0.8 });
        }
    });

    // 2. Naming patterns (e.g. User.ts -> UserService.ts, UserRepo.ts)
    const patterns = await vscode.workspace.findFiles(`**/${currentBase}*`);
    patterns.forEach(p => {
        if (p.fsPath !== currentPath && !relations.find(r => r.path === p.fsPath)) {
            relations.push({ path: p.fsPath, type: 'related_name', score: 0.9 });
        }
    });

    return relations.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * Formats project graph relations for the AI.
   */
  public formatForPrompt(relations: FileRelation[]): string {
    if (relations.length === 0) return '';

    const lines = relations.map(r => {
        const relPath = vscode.workspace.asRelativePath(r.path);
        return `- ${relPath} (${r.type})`;
    });

    return `<project_relationships>\n${lines.join('\n')}\n</project_relationships>`;
  }
}
