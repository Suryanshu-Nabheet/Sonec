/**
 * AutoCode Settings Panel
 * 
 * Minimal, professional webview settings for:
 * - Provider & API key configuration
 * - Engine feature toggles
 * - Performance tuning
 */

import * as vscode from 'vscode';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

export class SettingsPanel implements vscode.Disposable {
  public static currentPanel: SettingsPanel | undefined;
  private static readonly viewType = 'autocode.settings';

  private readonly panel: vscode.WebviewPanel;
  private readonly config: ConfigManager;
  private readonly logger: Logger;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    _extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.config = ConfigManager.getInstance();
    this.logger = Logger.getInstance();

    this.panel.webview.html = this.getWebviewContent();

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.disposables.push(
      this.config.onConfigChange(() => {
        this.panel.webview.postMessage({
          type: 'configUpdate',
          config: this.getSafeConfig(),
        });
      })
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      'AutoCode Settings',
      column || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
    );

    SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri);
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'getConfig':
        this.panel.webview.postMessage({
          type: 'configUpdate',
          config: this.getSafeConfig(),
        });
        break;

      case 'saveConfig':
        await this.saveConfig(message.key, message.value);
        break;

      case 'saveApiKey':
        await this.saveApiKey(message.provider, message.apiKey);
        break;

      case 'testConnection':
        await this.testConnection();
        break;

      case 'openOutputLog':
        Logger.getInstance().show();
        break;
    }
  }

  private async saveConfig(key: string, value: any): Promise<void> {
    try {
      await vscode.workspace
        .getConfiguration('autocode')
        .update(key, value, vscode.ConfigurationTarget.Global);

      this.panel.webview.postMessage({
        type: 'saveResult',
        success: true,
        key,
        message: `${key} updated`,
      });

      this.logger.info(`Config updated: ${key} = ${typeof value === 'string' && key === 'apiKey' ? '***' : value}`);
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'saveResult',
        success: false,
        key,
        message: `Failed to save ${key}`,
      });
      this.logger.error(`Failed to save config: ${key}`, err);
    }
  }

  private async saveApiKey(provider: string, apiKey: string): Promise<void> {
    try {
      await vscode.workspace
        .getConfiguration('autocode')
        .update('apiKey', apiKey, vscode.ConfigurationTarget.Global);

      if (provider) {
        await vscode.workspace
          .getConfiguration('autocode')
          .update('provider', provider, vscode.ConfigurationTarget.Global);
      }

      this.panel.webview.postMessage({
        type: 'saveResult',
        success: true,
        key: 'apiKey',
        message: 'API key saved',
      });

      this.logger.info(`API key updated for provider: ${provider}`);
    } catch (err) {
      this.panel.webview.postMessage({
        type: 'saveResult',
        success: false,
        key: 'apiKey',
        message: 'Failed to save API key',
      });
    }
  }

  private async testConnection(): Promise<void> {
    this.panel.webview.postMessage({
      type: 'connectionTest',
      status: 'testing',
      message: 'Testing connection...',
    });

    try {
      const config = this.config.get();
      let endpoint = '';
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      switch (config.provider) {
        case 'openai':
          endpoint = (config.apiEndpoint || 'https://api.openai.com/v1') + '/models';
          headers['Authorization'] = `Bearer ${config.apiKey}`;
          break;
        case 'anthropic':
          endpoint = (config.apiEndpoint || 'https://api.anthropic.com/v1') + '/messages';
          headers['x-api-key'] = config.apiKey;
          headers['anthropic-version'] = '2023-06-01';
          break;
        case 'ollama':
          endpoint = (config.apiEndpoint || 'http://localhost:11434') + '/api/tags';
          break;
        case 'custom':
          endpoint = config.apiEndpoint + '/models';
          headers['Authorization'] = `Bearer ${config.apiKey}`;
          break;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        this.panel.webview.postMessage({
          type: 'connectionTest',
          status: 'success',
          message: `Connected to ${config.provider} (${response.status})`,
        });
      } else {
        this.panel.webview.postMessage({
          type: 'connectionTest',
          status: 'error',
          message: `Failed: ${response.status} ${response.statusText}`,
        });
      }
    } catch (err: any) {
      const message = err.name === 'AbortError'
        ? 'Connection timed out (10s)'
        : err.message || 'Unknown error';

      this.panel.webview.postMessage({
        type: 'connectionTest',
        status: 'error',
        message: `Failed: ${message}`,
      });
    }
  }

  private getSafeConfig(): Record<string, any> {
    const config = this.config.get();
    return {
      enabled: config.enabled,
      provider: config.provider,
      model: config.model,
      apiKeySet: !!config.apiKey,
      apiKeyPreview: config.apiKey
        ? config.apiKey.substring(0, 6) + '••••' + config.apiKey.substring(config.apiKey.length - 4)
        : '',
      apiEndpoint: config.apiEndpoint,
      maxContextTokens: config.maxContextTokens,
      debounceMs: config.debounceMs,
      prefetchEnabled: config.prefetchEnabled,
      maxCompletionLines: config.maxCompletionLines,
      streamingEnabled: config.streamingEnabled,
      cacheEnabled: config.cacheEnabled,
      cacheTTLSeconds: config.cacheTTLSeconds,
      styleLearnEnabled: config.styleLearnEnabled,
      logLevel: config.logLevel,
    };
  }

  private getWebviewContent(): string {
    const nonce = getNonce();

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>AutoCode Settings</title>
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.5;
    }

    .header {
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      padding: 20px 28px 16px;
    }

    .header h1 {
      font-size: 18px;
      font-weight: 600;
    }

    .header p {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-top: 2px;
    }

    .badge {
      display: inline-block;
      margin-top: 8px;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
    }

    .badge.ok {
      background: rgba(115,201,145,0.12);
      color: var(--vscode-testing-iconPassed, #73c991);
    }

    .badge.warn {
      background: rgba(204,167,0,0.12);
      color: var(--vscode-editorWarning-foreground, #cca700);
    }

    .wrap {
      max-width: 600px;
      padding: 16px 28px 40px;
    }

    .sec {
      margin-bottom: 20px;
    }

    .sec-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    }

    .fg {
      margin-bottom: 12px;
    }

    .fg:last-child { margin-bottom: 0; }

    label.fl {
      display: block;
      font-weight: 500;
      font-size: 13px;
      margin-bottom: 3px;
    }

    .fh {
      font-size: 11px;
      color: var(--vscode-disabledForeground);
      margin-top: 2px;
    }

    .fr {
      display: flex;
      gap: 10px;
    }

    .fr > .fg { flex: 1; }

    input[type="text"],
    input[type="password"],
    input[type="number"],
    select {
      width: 100%;
      padding: 5px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-editor-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.25));
      border-radius: 2px;
      font-family: inherit;
      font-size: 13px;
      outline: none;
    }

    input:focus, select:focus {
      border-color: var(--vscode-focusBorder);
    }

    input[type="number"] { max-width: 100px; }

    .kw {
      position: relative;
    }

    .kw input { padding-right: 50px; }

    .kw button {
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--vscode-disabledForeground);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
    }

    .kp {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: var(--vscode-disabledForeground);
      margin-top: 2px;
    }

    .pg {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 12px;
    }

    .pc {
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.25));
      border-radius: 2px;
      cursor: pointer;
      text-align: center;
    }

    .pc.on {
      border-color: var(--vscode-focusBorder);
      background: rgba(128,128,128,0.06);
    }

    .pc b { font-size: 13px; display: block; }
    .pc small { font-size: 10px; color: var(--vscode-disabledForeground); }

    .or {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
    }

    .or + .or {
      border-top: 1px solid rgba(128,128,128,0.08);
    }

    .ot { flex: 1; }
    .on-label { font-weight: 500; font-size: 13px; }
    .od { font-size: 11px; color: var(--vscode-disabledForeground); }

    .sw {
      position: relative;
      width: 34px;
      height: 18px;
      flex-shrink: 0;
      margin-left: 12px;
    }

    .sw input { opacity: 0; width: 0; height: 0; }

    .sl {
      position: absolute;
      cursor: pointer;
      inset: 0;
      background: var(--vscode-input-border, rgba(128,128,128,0.25));
      border-radius: 18px;
    }

    .sl::before {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      left: 3px;
      bottom: 3px;
      background: var(--vscode-editor-foreground);
      border-radius: 50%;
    }

    .sw input:checked + .sl {
      background: var(--vscode-button-background);
    }

    .sw input:checked + .sl::before {
      transform: translateX(16px);
      background: var(--vscode-button-foreground);
    }

    .b {
      padding: 5px 12px;
      border: none;
      border-radius: 2px;
      font-family: inherit;
      font-size: 13px;
      cursor: pointer;
    }

    .bp {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .bs {
      background: transparent;
      color: var(--vscode-editor-foreground);
      border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.25));
    }

    .br {
      display: flex;
      gap: 6px;
      margin-top: 10px;
    }

    .toast {
      position: fixed;
      bottom: 12px;
      right: 12px;
      padding: 6px 12px;
      border-radius: 3px;
      font-size: 12px;
      display: none;
      z-index: 10;
    }

    .toast.show { display: block; }
    .toast.ok { background: rgba(115,201,145,0.12); color: var(--vscode-testing-iconPassed, #73c991); }
    .toast.err { background: rgba(244,71,71,0.12); color: var(--vscode-errorForeground, #f44747); }
    .toast.inf { background: rgba(128,128,128,0.08); color: var(--vscode-descriptionForeground); }

    .kg {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 10px;
      font-size: 12px;
    }

    .kg kbd {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      border-radius: 2px;
      padding: 1px 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }

    .kg span { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="header">
    <h1>AutoCode Settings</h1>
    <p>Structured Omniscient Neural Editor & Compiler</p>
    <div class="badge warn" id="badge"><span id="badgeText">Checking...</span></div>
  </div>

  <div class="wrap">
    <div class="sec">
      <div class="sec-title">Provider & Authentication</div>

      <div class="fg">
        <label class="fl">Provider</label>
        <div class="pg" id="pg">
          <div class="pc" data-p="openai"><b>OpenAI</b><small>GPT-4o, GPT-4 Turbo</small></div>
          <div class="pc" data-p="anthropic"><b>Anthropic</b><small>Claude 3.5, Claude 4</small></div>
          <div class="pc" data-p="ollama"><b>Ollama</b><small>Local models (free)</small></div>
          <div class="pc" data-p="custom"><b>Custom</b><small>OpenAI-compatible</small></div>
        </div>
      </div>

      <div class="fg" id="akGrp">
        <label class="fl">API Key</label>
        <div class="kw">
          <input type="password" id="akIn" placeholder="Enter API key..." autocomplete="off">
          <button id="akToggle" type="button">Show</button>
        </div>
        <div class="kp" id="akPrev"></div>
        <div class="fh">Stored in VS Code settings. Only sent to the selected provider.</div>
      </div>

      <div class="fg">
        <label class="fl">Model</label>
        <input type="text" id="mdIn" placeholder="e.g. gpt-4o, claude-sonnet-4-20250514, llama3.1">
      </div>

      <div class="fg">
        <label class="fl">API Endpoint</label>
        <input type="text" id="epIn" placeholder="http://localhost:11434">
        <div class="fh">Override default. Required for Ollama and Custom.</div>
      </div>

      <div class="br">
        <button class="b bp" id="saveAuth">Save</button>
        <button class="b bs" id="testConn">Test Connection</button>
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">Engine</div>

      <div class="or"><div class="ot"><div class="on-label">Enabled</div><div class="od">Master switch</div></div>
        <label class="sw"><input type="checkbox" id="tEn" data-k="enabled"><span class="sl"></span></label></div>

      <div class="or"><div class="ot"><div class="on-label">Streaming</div><div class="od">Chunked responses</div></div>
        <label class="sw"><input type="checkbox" id="tStr" data-k="streamingEnabled"><span class="sl"></span></label></div>

      <div class="or"><div class="ot"><div class="on-label">Prefetch</div><div class="od">Pre-generate next completion</div></div>
        <label class="sw"><input type="checkbox" id="tPre" data-k="prefetchEnabled"><span class="sl"></span></label></div>


      <div class="or"><div class="ot"><div class="on-label">Style Learning</div><div class="od">Match project conventions</div></div>
        <label class="sw"><input type="checkbox" id="tSl" data-k="styleLearnEnabled"><span class="sl"></span></label></div>

      <div class="or"><div class="ot"><div class="on-label">Cache</div><div class="od">LRU completion cache</div></div>
        <label class="sw"><input type="checkbox" id="tCa" data-k="cacheEnabled"><span class="sl"></span></label></div>
    </div>

    <div class="sec">
      <div class="sec-title">Performance</div>

      <div class="fr">
        <div class="fg"><label class="fl">Debounce (ms)</label>
          <input type="number" id="nDb" min="50" max="500" step="10"></div>
        <div class="fg"><label class="fl">Context Tokens</label>
          <input type="number" id="nCt" min="1024" max="32768" step="1024"></div>
      </div>

      <div class="fr">
        <div class="fg"><label class="fl">Max Lines</label>
          <input type="number" id="nMl" min="5" max="200" step="5"></div>
        <div class="fg"><label class="fl">Cache TTL (sec)</label>
          <input type="number" id="nTtl" min="30" max="3600" step="30"></div>
      </div>

      <div class="fg">
        <label class="fl">Log Level</label>
        <select id="sLog">
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div class="br">
        <button class="b bp" id="savePerf">Save</button>
        <button class="b bs" id="openLog">Open Log</button>
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">Shortcuts</div>
      <div class="kg">
        <kbd>Tab</kbd> <span>Accept suggestion</span>
        <kbd>Cmd+→</kbd> <span>Accept word</span>
        <kbd>Cmd+Shift+→</kbd> <span>Accept line</span>
        <kbd>Esc</kbd> <span>Dismiss</span>
        <kbd>Ctrl+Space</kbd> <span>Force trigger</span>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let cfg = {};

    vscode.postMessage({ type: 'getConfig' });

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'configUpdate') { cfg = m.config; render(m.config); }
      if (m.type === 'saveResult') toast(m.success ? 'ok' : 'err', m.message);
      if (m.type === 'connectionTest') toast(m.status === 'success' ? 'ok' : m.status === 'error' ? 'err' : 'inf', m.message);
    });

    function render(c) {
      const b = document.getElementById('badge');
      const bt = document.getElementById('badgeText');
      if (c.apiKeySet || c.provider === 'ollama') { b.className = 'badge ok'; bt.textContent = 'Ready — ' + c.provider + ' / ' + c.model; }
      else { b.className = 'badge warn'; bt.textContent = 'API Key Required'; }

      document.querySelectorAll('.pc').forEach(p => p.classList.toggle('on', p.dataset.p === c.provider));
      document.getElementById('akGrp').style.display = c.provider === 'ollama' ? 'none' : '';
      if (c.apiEndpoint) document.getElementById('epIn').value = c.apiEndpoint;

      const pv = document.getElementById('akPrev');
      pv.textContent = c.apiKeySet ? 'Current: ' + c.apiKeyPreview : '';

      document.getElementById('mdIn').value = c.model || '';
      document.getElementById('tEn').checked = c.enabled;
      document.getElementById('tStr').checked = c.streamingEnabled;
      document.getElementById('tPre').checked = c.prefetchEnabled;
      document.getElementById('tSl').checked = c.styleLearnEnabled;
      document.getElementById('tCa').checked = c.cacheEnabled;
      document.getElementById('nDb').value = c.debounceMs;
      document.getElementById('nCt').value = c.maxContextTokens;
      document.getElementById('nMl').value = c.maxCompletionLines;
      document.getElementById('nTtl').value = c.cacheTTLSeconds;
      document.getElementById('sLog').value = c.logLevel;
    }

    document.querySelectorAll('.pc').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.pc').forEach(c => c.classList.remove('on'));
        card.classList.add('on');
        cfg.provider = card.dataset.p;
        document.getElementById('akGrp').style.display = card.dataset.p === 'ollama' ? 'none' : '';
        if (card.dataset.p === 'ollama' && !document.getElementById('epIn').value)
          document.getElementById('epIn').value = 'http://localhost:11434';
        const mi = document.getElementById('mdIn');
        const d = { openai: 'gpt-4o', anthropic: 'claude-sonnet-4-20250514', ollama: 'llama3.1', custom: 'gpt-4o' };
        if (!mi.value || Object.values(d).includes(mi.value)) mi.value = d[card.dataset.p] || '';
      });
    });

    document.getElementById('akToggle').addEventListener('click', () => {
      const i = document.getElementById('akIn');
      const b = document.getElementById('akToggle');
      const s = i.type === 'password';
      i.type = s ? 'text' : 'password';
      b.textContent = s ? 'Hide' : 'Show';
    });

    document.getElementById('saveAuth').addEventListener('click', () => {
      const prov = document.querySelector('.pc.on')?.dataset.p || 'openai';
      const key = document.getElementById('akIn').value;
      const model = document.getElementById('mdIn').value;
      const ep = document.getElementById('epIn').value;

      vscode.postMessage({ type: 'saveConfig', key: 'provider', value: prov });
      if (model) vscode.postMessage({ type: 'saveConfig', key: 'model', value: model });
      if (ep) vscode.postMessage({ type: 'saveConfig', key: 'apiEndpoint', value: ep });
      if (key) {
        vscode.postMessage({ type: 'saveApiKey', provider: prov, apiKey: key });
        document.getElementById('akIn').value = '';
      } else if (prov !== 'ollama' && !cfg.apiKeySet) {
        toast('err', 'Enter an API key');
        return;
      }
      toast('ok', 'Saved');
    });

    document.getElementById('testConn').addEventListener('click', () => {
      vscode.postMessage({ type: 'testConnection' });
    });

    document.querySelectorAll('.sw input').forEach(t => {
      t.addEventListener('change', () => {
        vscode.postMessage({ type: 'saveConfig', key: t.dataset.k, value: t.checked });
      });
    });

    document.getElementById('savePerf').addEventListener('click', () => {
      [{ i:'nDb', k:'debounceMs' }, { i:'nCt', k:'maxContextTokens' },
       { i:'nMl', k:'maxCompletionLines' }, { i:'nTtl', k:'cacheTTLSeconds' }].forEach(f => {
        vscode.postMessage({ type: 'saveConfig', key: f.k, value: parseInt(document.getElementById(f.i).value) });
      });
      vscode.postMessage({ type: 'saveConfig', key: 'logLevel', value: document.getElementById('sLog').value });
      toast('ok', 'Saved');
    });

    document.getElementById('openLog').addEventListener('click', () => {
      vscode.postMessage({ type: 'openOutputLog' });
    });

    function toast(t, m) {
      const el = document.getElementById('toast');
      el.className = 'toast show ' + t;
      el.textContent = m;
      clearTimeout(window._tt);
      window._tt = setTimeout(() => { el.className = 'toast'; }, 3000);
    }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    SettingsPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
