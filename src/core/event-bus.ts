/**
 * SONEC Event Bus
 * 
 * Central event system for decoupled inter-module communication.
 * All engine events flow through this bus for observability and coordination.
 */

import * as vscode from 'vscode';
import { SonecEvent, SonecEventHandler } from './types';
import { Logger } from './logger';

export class EventBus implements vscode.Disposable {
  private static instance: EventBus;
  private handlers: Map<string, Set<SonecEventHandler>> = new Map();
  private globalHandlers: Set<SonecEventHandler> = new Set();
  private eventHistory: SonecEvent[] = [];
  private readonly MAX_HISTORY = 200;
  private logger: Logger;

  private constructor() {
    this.logger = Logger.getInstance();
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /** Emit an event to all registered handlers */
  emit(event: SonecEvent): void {
    this.logger.debug(`Event: ${event.type}`, event.data);

    // Store in history ring buffer
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.MAX_HISTORY) {
      this.eventHistory.shift();
    }

    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch (err) {
          this.logger.error(`Event handler error for ${event.type}`, err);
        }
      }
    }

    // Notify global handlers
    for (const handler of this.globalHandlers) {
      try {
        handler(event);
      } catch (err) {
        this.logger.error(`Global event handler error`, err);
      }
    }
  }

  /** Subscribe to a specific event type */
  on(eventType: SonecEvent['type'], handler: SonecEventHandler): vscode.Disposable {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return new vscode.Disposable(() => {
      this.handlers.get(eventType)?.delete(handler);
    });
  }

  /** Subscribe to all events */
  onAll(handler: SonecEventHandler): vscode.Disposable {
    this.globalHandlers.add(handler);
    return new vscode.Disposable(() => {
      this.globalHandlers.delete(handler);
    });
  }

  /** Get recent event history for a specific type */
  getHistory(type?: SonecEvent['type'], limit: number = 50): SonecEvent[] {
    let events = this.eventHistory;
    if (type) {
      events = events.filter((e) => e.type === type);
    }
    return events.slice(-limit);
  }

  dispose(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
    this.eventHistory = [];
  }
}
