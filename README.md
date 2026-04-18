# SONEC: Structured Omniscient Neural Editor & Compiler

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-0.1.0-blue.svg)]()

# SONEC — Autonomous Code Engine

**Structured Omniscient Neural Editor & Compiler** - Production-grade VS Code extension for autonomous code completion, transformation, and multi-file intelligence.

---

## ✨ Premium Features

- **🧠 Intelligent Code Completion**: Advanced context-aware completions with fallback mechanisms
- **⚡ Supermaven-Grade Suggestions**: Premium code predictions even in minimal contexts
- **🔄 Autonomous Refactoring**: Automatic code improvements and optimizations
- **🎯 Predictive Navigation**: Smart jump-to-next-edit functionality
- **🌐 Multi-Provider Support**: OpenAI, Anthropic, Ollama, and custom endpoints
- **📡 Real-time Streaming**: Instant responses with cancellation support
- **📚 Project Learning**: Adapts to your coding style and patterns
- **🚀 Production-Grade UI**: Clean, professional interface without intrusive messages

## 🔧 Core Capabilities

- **Autonomous Inline Completions**: Real-time code generation powered by a context-aware ranking engine.
- **Architectural Transformations**: Multi-file refactoring and feature implementation via planned atomic actions.
- **Speculative Prefetching**: Reduces perceived latency by pre-calculating completions using trajectory analysis.
- **Deep Contextual Awareness**: Analyzes symbols, imports, git history, and project-specific coding patterns.
- **Transaction-Safe Edits**: Complex changes are applied atomically with a reliable multi-file undo stack.

- **Predictive Navigation**: Smart jump-to-next-edit functionality
- **Multi-Provider Support**: OpenAI, Anthropic, Ollama, and custom endpoints
- **Real-time Streaming**: Instant responses with cancellation support
- **Project Learning**: Adapts to your coding style and patterns
- **Production-Grade UI**: Clean, professional interface without intrusive messages

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Version 18.x or higher)
- [VS Code](https://code.visualstudio.com/)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/Sonec.git
   ```

2. **Initialize development environment**:
   ```bash
   chmod +x ./scripts/setup.sh
   ./scripts/setup.sh
   ```

3. **Open in VS Code**:
   ```bash
   code .
   ```

4. **Launch Extension**:
   Press `F5` to open the Extension Development Host.

## Documentation

For deep dives into the engine's internals and contributing guidelines, see the standard documentation:

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Internal API Documentation](./docs/API.md)
- [Contribution Guidelines](./docs/CONTRIBUTING.md)

## Configuration

| Key | Type | Description |
|-----|------|-------------|
| `sonec.enabled` | `boolean` | Activates the core engine services. |
| `sonec.provider` | `enum` | LLM provider (ollama, anthropic, openai, custom). |
| `sonec.model` | `string` | Specific model identifier (e.g., `qwen2.5-coder:1.5b`). |
| `sonec.streamingEnabled` | `boolean` | Enables real-time token streaming for zero latency. |
| `sonec.multiFileEnabled` | `boolean` | Allows the engine to plan edits across multiple files. |

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
