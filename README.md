# SONEC — Structured Omniscient Neural Editor & Compiler

> Autonomous code completion, transformation, and multi-file intelligence engine for Visual Studio Code.

SONEC goes beyond traditional autocomplete. It behaves as an **intelligent coding engine** capable of predicting full code blocks, executing structured edits across multiple files, and creating a **flow state** coding experience — all without a chat interface.

---

## Features

- **Inline Completions** — Context-aware code generation with partial acceptance (word-by-word, line-by-line)
- **Structured Transformations** — Multi-file edit plans with atomic application and undo
- **Next-Edit Prediction** — Jump to where you need to edit next across files
- **Deep Context Engine** — Symbol graphs, import analysis, git diffs, style pattern learning
- **Multi-Provider Support** — OpenAI, Anthropic, Ollama (local), or custom endpoints
- **Performance Optimized** — Streaming, prefetching, caching, debouncing

## Quick Start

1. Install dependencies: `npm install`
2. Configure your API key in VS Code Settings → SONEC
3. Press `F5` to launch the extension in debug mode

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `sonec.enabled` | `true` | Enable/disable the engine |
| `sonec.provider` | `openai` | AI provider (openai/anthropic/ollama/custom) |
| `sonec.model` | `gpt-4o` | Model identifier |
| `sonec.apiKey` | `""` | API key for the provider |
| `sonec.debounceMs` | `150` | Debounce delay before triggering |
| `sonec.streamingEnabled` | `true` | Enable streaming for lower latency |
| `sonec.prefetchEnabled` | `true` | Enable speculative prefetching |
| `sonec.multiFileEnabled` | `true` | Enable multi-file edit suggestions |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Tab` | Accept full suggestion |
| `Cmd/Ctrl + →` | Accept next word |
| `Cmd/Ctrl + Shift + →` | Accept next line |
| `Cmd/Ctrl + ]` | Jump to next predicted edit |
| `Cmd/Ctrl + [` | Jump to previous predicted edit |
| `Cmd/Ctrl + Shift + Enter` | Apply full transformation |
| `Escape` | Dismiss suggestion |
| `Ctrl + Space` | Force trigger completion |

## Architecture

```
┌───────────────────────────── VS Code Extension ─────────────────────────────┐
│                                                                              │
│  Completion Provider ──► Prediction Engine ──► Model Layer                   │
│         │                      │                    │                        │
│         ▼                      ▼                    ▼                        │
│  Command Handlers        Context Engine        Prompt Builder                │
│         │                      │                                             │
│         ▼                      ▼                                             │
│  Action Execution     Symbol/Import/Git/Style                                │
│  Engine (atomic        Analyzers + Context                                   │
│   undo stack)          Ranker                                                │
│                                                                              │
│  ─────────────────── Performance + Cache + Events ──────────────────────     │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Development

```bash
npm install
npm run watch    # Continuous compilation
# Press F5 in VS Code to launch Extension Host
```

## License

MIT
