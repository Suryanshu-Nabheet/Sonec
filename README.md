# SONEC: Structured Omniscient Neural Editor & Compiler

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-0.1.0-blue.svg)]()

SONEC is a production-grade autonomous code engine designed for high-velocity software engineering. By aggressively minimizing end-to-end latency and structurally mapping cross-file dependencies, it provides real-time intelligent completions without degrading IDE performance.

---

## High-Performance Engineering

The extension has been rearchitected from the ground up to achieve state-of-the-art responsiveness and strictly adhere to sub-100ms response targets:

- **Zero-Latency Predictive Ghost Text**: Intelligent keystroke continuity. The engine tracks partial cache states against user input, instantly fast-forwarding and accurately slicing predictive text on every keystroke without requiring secondary LLM API roundtrips.
- **Parallel Context Matrix**: Deep project synchronization happens instantly. Multi-file graph traversal, symbol impact isolation, git history, and semantic structure detection are aggregated via highly parallelized background routines.
- **Dynamic Semantic Outdenting**: Deep awareness of structural code blocks. The system monitors live cursor indentation and halts prediction execution immediately upon detecting syntax scope termination (e.g., exiting a class or interface), massively capping token burn and preventing model hallucination.
- **Pristine Operating Silence**: A professional-grade integration. The prediction and trajectory engines function completely invisibly, resolving tasks autonomously without populating the editor with obtrusive popups, loading notifications, or tracking indicators.

## Core Capabilities

- **Autonomous Inline Completions**: Real-time generation powered by deterministic contextual rankers.
- **Architectural Transformations**: Deep multi-file refactoring executed as guaranteed atomic transactions via a proprietary undo stack.
- **Speculative Prefetching**: Predicts target editing destinations and resolves logic completions before cursor navigation.
- **Project Learning**: Learns your architectural conventions natively.
- **Multi-Provider Connectivity**: Connect your local (Ollama) or remote (OpenAI, Anthropic) instances securely.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Version 18.x or higher)
- [VS Code](https://code.visualstudio.com/)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/sonec.git
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

Extensive documentation of the underlying architecture and APIs is available:

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
