/**
 * SONEC Configuration Manager
 * 
 * Centralized configuration management with real-time change detection
 * and validation. All modules read configuration through this singleton.
 */

import * as vscode from 'vscode';
import { SonecConfig, ModelProvider, LogLevel } from './types';

const CONFIG_SECTION = 'sonec';

const DEFAULT_CONFIG: SonecConfig = {
  enabled: true,
  provider: 'ollama',
  model: 'qwen2.5-coder:1.5b',
  apiKey: '',
  apiEndpoint: 'http://localhost:11434',
  maxContextTokens: 8192,
  debounceMs: 50,
  prefetchEnabled: true,
  multiFileEnabled: true,
  maxCompletionLines: 50,
  streamingEnabled: true,
  cacheEnabled: true,
  cacheTTLSeconds: 300,
  styleLearnEnabled: true,
  telemetryEnabled: false,
  logLevel: 'info',
};

export class ConfigManager implements vscode.Disposable {
  private static instance: ConfigManager;
  private config: SonecConfig;
  private disposables: vscode.Disposable[] = [];
  private changeEmitter = new vscode.EventEmitter<Partial<SonecConfig>>();

  /** Fired when any configuration value changes */
  public readonly onConfigChange = this.changeEmitter.event;

  private constructor() {
    this.config = this.loadConfig();

    // Watch for configuration changes in real-time
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(CONFIG_SECTION)) {
          const oldConfig = { ...this.config };
          this.config = this.loadConfig();
          const changed = this.diffConfig(oldConfig, this.config);
          if (Object.keys(changed).length > 0) {
            this.changeEmitter.fire(changed);
          }
        }
      })
    );
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /** Get a snapshot of the current config */
  get(): SonecConfig {
    return { ...this.config };
  }

  /** Get a single config value */
  getValue<K extends keyof SonecConfig>(key: K): SonecConfig[K] {
    return this.config[key];
  }

  /** Check if the engine is enabled and properly configured with enhanced validation */
  isReady(): boolean {
    if (!this.config.enabled) {return false;}
    
    // Provider-specific validation
    switch (this.config.provider) {
      case 'ollama':
        return true; // Ollama uses local endpoint, no key needed
      case 'openai':
        return !!this.config.apiKey && this.config.apiKey.trim().length > 0;
      case 'anthropic':
        return !!this.config.apiKey && this.config.apiKey.trim().length > 0;
      case 'custom':
        return !!this.config.apiEndpoint && this.config.apiEndpoint.trim().length > 0;
      default:
        return false;
    }
  }

  /** Get the effective API endpoint for the current provider */
  getEndpoint(): string {
    switch (this.config.provider) {
      case 'openai':
        return this.config.apiEndpoint || 'https://api.openai.com/v1';
      case 'anthropic':
        return this.config.apiEndpoint || 'https://api.anthropic.com/v1';
      case 'ollama':
        return this.config.apiEndpoint || 'http://localhost:11434';
      case 'custom':
        return this.config.apiEndpoint;
    }
  }

  private loadConfig(): SonecConfig {
    const wsConfig = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return {
      enabled: wsConfig.get<boolean>('enabled', DEFAULT_CONFIG.enabled),
      provider: wsConfig.get<ModelProvider>('provider', DEFAULT_CONFIG.provider),
      model: wsConfig.get<string>('model', DEFAULT_CONFIG.model),
      apiKey: wsConfig.get<string>('apiKey', DEFAULT_CONFIG.apiKey),
      apiEndpoint: wsConfig.get<string>('apiEndpoint', DEFAULT_CONFIG.apiEndpoint),
      maxContextTokens: wsConfig.get<number>('maxContextTokens', DEFAULT_CONFIG.maxContextTokens),
      debounceMs: wsConfig.get<number>('debounceMs', DEFAULT_CONFIG.debounceMs),
      prefetchEnabled: wsConfig.get<boolean>('prefetchEnabled', DEFAULT_CONFIG.prefetchEnabled),
      multiFileEnabled: wsConfig.get<boolean>('multiFileEnabled', DEFAULT_CONFIG.multiFileEnabled),
      maxCompletionLines: wsConfig.get<number>('maxCompletionLines', DEFAULT_CONFIG.maxCompletionLines),
      streamingEnabled: wsConfig.get<boolean>('streamingEnabled', DEFAULT_CONFIG.streamingEnabled),
      cacheEnabled: wsConfig.get<boolean>('cacheEnabled', DEFAULT_CONFIG.cacheEnabled),
      cacheTTLSeconds: wsConfig.get<number>('cacheTTLSeconds', DEFAULT_CONFIG.cacheTTLSeconds),
      styleLearnEnabled: wsConfig.get<boolean>('styleLearnEnabled', DEFAULT_CONFIG.styleLearnEnabled),
      telemetryEnabled: wsConfig.get<boolean>('telemetryEnabled', DEFAULT_CONFIG.telemetryEnabled),
      logLevel: wsConfig.get<LogLevel>('logLevel', DEFAULT_CONFIG.logLevel),
    };
  }

  private diffConfig(
    oldConfig: SonecConfig,
    newConfig: SonecConfig
  ): Partial<SonecConfig> {
    const changed: Partial<SonecConfig> = {};
    for (const key of Object.keys(newConfig) as (keyof SonecConfig)[]) {
      if (oldConfig[key] !== newConfig[key]) {
        (changed as any)[key] = newConfig[key];
      }
    }
    return changed;
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
