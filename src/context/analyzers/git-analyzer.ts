/**
 * AutoCode Git Analyzer
 * 
 * Extracts recent git diffs and change history to provide
 * temporal context about what the developer has been working on.
 */

import * as vscode from 'vscode';
import { GitDiff } from '../../core/types';
import { Logger } from '../../core/logger';

/**
 * Orchestrates the extraction and parsing of Git metadata for contextual awareness.
 */
export class GitAnalyzer {
  private logger = Logger.getInstance();
  private diffCache: { diffs: GitDiff[]; timestamp: number } | null = null;
  private readonly CACHE_TTL = 10_000; // 10 seconds

  /**
   * Get recent git diffs (unstaged changes from the working tree).
   * @returns A promise that resolves to an array of GitDiff objects
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

      // Limit to top 10 files to avoid performance degradation
      for (const change of changes.slice(0, 10)) {
        try {
          const diff = await this.parseDiff(repo, change);
          if (diff) {
            diffs.push(diff);
          }
        } catch (err) {
          this.logger.warn(`Failed to diff file: ${change.uri.fsPath}`);
        }
      }

      // Cache the results
      this.diffCache = { diffs, timestamp: Date.now() };

      return diffs;
    } catch (err) {
      this.logger.error('Git diff extraction failed', err);
      return [];
    }
  }

  /**
   * Get the list of recently modified files (working tree and index).
   * @returns A promise that resolves to an array of relative file paths
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
    } catch (err) {
      this.logger.error('Failed to get recently modified files', err);
      return [];
    }
  }

  /**
   * Parse a git change into the internal GitDiff format.
   * @param repo The VS Code Git repository instance
   * @param change The change object from VS Code Git extension
   * @returns A promise that resolves to a GitDiff object or null
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
    } catch (err) {
      this.logger.debug(`Error parsing diff for ${change.uri.fsPath}: ${err}`);
      return null;
    }
  }

  /**
   * Parse unified diff output into structured hunks.
   * @param diffText The raw unified diff text
   * @returns An array of structured hunks
   */
  private parseUnifiedDiff(
    diffText: string
  ): GitDiff['hunks'] {
    const hunks: GitDiff['hunks'] = [];
    // Enhanced regex to match unified diff hunk headers accurately
    const hunkRegex = /^@@\s*-(\d+),?(\d*)\s*\+(\d+),?(\d*)\s*@@/gm;
    let match;

    const lines = diffText.split('\n');
    let currentHunk: GitDiff['hunks'][0] | null = null;
    let currentContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = hunkRegex.exec(line);
        hunkRegex.lastIndex = 0; // Reset for next line manual test

        if (match) {
            // If we were already building a hunk, save it
            if (currentHunk) {
                currentHunk.content = currentContent.join('\n');
                hunks.push(currentHunk);
            }

            // Start a new hunk
            currentHunk = {
                oldStart: parseInt(match[1]),
                oldCount: parseInt(match[2] || '1'),
                newStart: parseInt(match[3]),
                newCount: parseInt(match[4] || '1'),
                content: ''
            };
            currentContent = [line];
        } else if (currentHunk) {
            currentContent.push(line);
        }
    }

    // Capture the final hunk
    if (currentHunk) {
        currentHunk.content = currentContent.join('\n');
        hunks.push(currentHunk);
    }

    return hunks;
  }

  /** 
   * Invalidate the current diff cache.
   */
  clearCache(): void {
    this.diffCache = null;
  }
}
