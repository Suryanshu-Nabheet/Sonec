/**
 * SONEC Git Analyzer
 * 
 * Extracts recent git diffs and change history to provide
 * temporal context about what the developer has been working on.
 */

import * as vscode from 'vscode';
import { GitDiff } from '../../core/types';
import { Logger } from '../../core/logger';

export class GitAnalyzer {
  private logger = Logger.getInstance();
  private diffCache: { diffs: GitDiff[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 10_000; // 10 seconds

  /**
   * Get recent git diffs (unstaged changes)
   */
  async getRecentDiffs(): Promise<GitDiff[]> {
    // Return cached if fresh
    if (
      this.diffCache &&
      Date.now() - this.diffCache.timestamp < this.CACHE_TTL
    ) {
      return this.diffCache.diffs;
    }

    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        return [];
      }

      const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();

      const api = git.getAPI(1);
      if (!api || api.repositories.length === 0) {
        return [];
      }

      const repo = api.repositories[0];
      const diffs: GitDiff[] = [];

      // Get diff of working tree changes
      const changes = repo.state.workingTreeChanges;

      for (const change of changes.slice(0, 10)) {
        try {
          const diff = await this.parseDiff(repo, change);
          if (diff) {
            diffs.push(diff);
          }
        } catch {
          // Skip files we can't diff
        }
      }

      // Cache
      this.diffCache = { diffs, timestamp: Date.now() };

      return diffs;
    } catch (err) {
      this.logger.error('Git diff extraction failed', err);
      return [];
    }
  }

  /**
   * Get the list of recently modified files from git
   */
  async getRecentlyModifiedFiles(): Promise<string[]> {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {return [];}

      const git = gitExtension.isActive
        ? gitExtension.exports
        : await gitExtension.activate();

      const api = git.getAPI(1);
      if (!api || api.repositories.length === 0) {return [];}

      const repo = api.repositories[0];
      const changes = [
        ...repo.state.workingTreeChanges,
        ...repo.state.indexChanges,
      ];

      return changes.map((c: any) =>
        vscode.workspace.asRelativePath(c.uri)
      );
    } catch {
      return [];
    }
  }

  /**
   * Parse a git change into our GitDiff format
   */
  private async parseDiff(
    repo: any,
    change: any
  ): Promise<GitDiff | null> {
    try {
      const diffOutput = await repo.diffWith('HEAD', change.uri.fsPath);
      if (!diffOutput) {return null;}

      const filePath = vscode.workspace.asRelativePath(change.uri);
      const hunks = this.parseUnifiedDiff(diffOutput);

      return { filePath, hunks };
    } catch {
      return null;
    }
  }

  /**
   * Parse unified diff format into structured hunks
   */
  private parseUnifiedDiff(
    diffText: string
  ): GitDiff['hunks'] {
    const hunks: GitDiff['hunks'] = [];
    const hunkRegex = /@@\s*-(\d+),?(\d*)\s*\+(\d+),?(\d*)\s*@@/g;
    let match;

    while ((match = hunkRegex.exec(diffText)) !== null) {
      const hunkStart = match.index;
      const nextMatch = hunkRegex.exec(diffText);
      const hunkEnd = nextMatch ? nextMatch.index : diffText.length;
      hunkRegex.lastIndex = match.index + match[0].length; // Reset for next iteration

      hunks.push({
        oldStart: parseInt(match[1]),
        oldCount: parseInt(match[2] || '1'),
        newStart: parseInt(match[3]),
        newCount: parseInt(match[4] || '1'),
        content: diffText.substring(hunkStart, hunkEnd).trim(),
      });

      if (nextMatch) {
        // Re-process next match
        hunkRegex.lastIndex = nextMatch.index;
      }
    }

    return hunks;
  }

  /** Clear diff cache */
  clearCache(): void {
    this.diffCache = null;
  }
}
