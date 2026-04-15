/**
 * SONEC Utility Functions
 * 
 * Shared utility functions used across multiple modules.
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Debounce a function call
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timer) {clearTimeout(timer);}
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Throttle a function to execute at most once per interval
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  intervalMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timer: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = intervalMs - (now - lastCall);

    if (remaining <= 0) {
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Create a cancellation token that auto-cancels after a timeout
 */
export function createTimeoutToken(
  timeoutMs: number
): vscode.CancellationTokenSource {
  const cts = new vscode.CancellationTokenSource();
  setTimeout(() => cts.cancel(), timeoutMs);
  return cts;
}

/**
 * Estimate token count from a string (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Average ~3.5 characters per token for code
  return Math.ceil(text.length / 3.5);
}

/**
 * Truncate text to approximately N tokens
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * 3.5);
  if (text.length <= maxChars) {return text;}
  return text.substring(0, maxChars);
}

/**
 * Get the workspace-relative path for a file
 */
export function getRelativePath(filePath: string): string {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsFolder && filePath.startsWith(wsFolder)) {
    return path.relative(wsFolder, filePath);
  }
  return filePath;
}

/**
 * Check if a file path is within the workspace
 */
export function isWorkspaceFile(filePath: string): boolean {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsFolder) {return false;}
  return filePath.startsWith(wsFolder);
}

/**
 * Simple hash function for strings (non-cryptographic)
 */
export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return hash;
}

/**
 * Deep merge two objects
 */
export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object'
    ) {
      (result as any)[key] = deepMerge(
        targetVal as Record<string, any>,
        sourceVal as Record<string, any>
      );
    } else if (sourceVal !== undefined) {
      (result as any)[key] = sourceVal;
    }
  }
  return result;
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.r': 'r',
    '.lua': 'lua',
    '.sh': 'shellscript',
    '.bash': 'shellscript',
    '.zsh': 'shellscript',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xml': 'xml',
    '.md': 'markdown',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.proto': 'protobuf',
    '.dockerfile': 'dockerfile',
    '.tf': 'terraform',
    '.vue': 'vue',
    '.svelte': 'svelte',
  };
  return langMap[ext] || 'plaintext';
}
