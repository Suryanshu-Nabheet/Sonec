/**
 * AutoCode History Tool
 * 
 * Analyzes Git history and recent file changes to understand the 
 * developer's intent and the evolution of the codebase.
 */

import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export class HistoryTool {
  private static instance: HistoryTool;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): HistoryTool {
    if (!HistoryTool.instance) {
      HistoryTool.instance = new HistoryTool();
    }
    return HistoryTool.instance;
  }

  /**
   * Gets the last few commits for a specific file.
   */
  public async getFileHistory(filePath: string, limit: number = 3): Promise<CommitInfo[]> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) return [];

      const { stdout } = await execAsync(
        `git log -n ${limit} --pretty=format:"%h|%s|%an|%ad" -- "${filePath}"`,
        { cwd: workspaceFolder }
      );

      if (!stdout) return [];

      return stdout.split('\n').map(line => {
        const [hash, message, author, date] = line.split('|');
        return { hash, message, author, date };
      });
    } catch (err) {
      this.logger.debug(`Failed to get git history for ${filePath}`);
      return [];
    }
  }

  /**
   * Formats the history for the AI prompt.
   */
  public formatForPrompt(history: CommitInfo[]): string {
    if (history.length === 0) return '';

    const lines = history.map(c => `- ${c.message} (${c.hash} by ${c.author})`);
    return `<recent_file_history>\n${lines.join('\n')}\n</recent_file_history>`;
  }
}
