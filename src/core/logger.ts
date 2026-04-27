/**
 * AutoCode Logger
 * 
 * Structured logging with level filtering, output channel integration,
 * and performance-safe formatting.
 */

import * as vscode from 'vscode';
import { LogLevel } from './types';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger implements vscode.Disposable {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private level: LogLevel = 'info';

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('AutoCode Engine');
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: unknown): void {
    this.log('error', message, error);
    if (error instanceof Error) {
      this.log('error', `Stack: ${error.stack}`);
    }
  }

  /** Log with timing — returns a function to call when the operation completes */
  time(label: string): () => number {
    const start = performance.now();
    this.debug(`START: ${label}`);
    return () => {
      const elapsed = performance.now() - start;
      this.debug(`END: ${label} (${elapsed.toFixed(2)}ms)`);
      return elapsed;
    };
  }

  show(): void {
    this.outputChannel.show(true);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString().slice(11, 23);
    const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}]`;
    let line = `${prefix} ${message}`;

    if (data !== undefined) {
      try {
        const serialized =
          typeof data === 'string'
            ? data
            : JSON.stringify(data, null, 0).slice(0, 500);
        line += ` | ${serialized}`;
      } catch {
        line += ' | [unserializable data]';
      }
    }

    this.outputChannel.appendLine(line);
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}
