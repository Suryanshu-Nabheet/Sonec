# AutoCode: Pure AI Code Completion Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-0.1.0-blue.svg)]()

AutoCode is a high-performance autonomous code completion engine for VS Code. It focuses exclusively on providing the fastest, most context-aware inline completions.

---

## High-Performance Engineering

The AutoCode engine is designed for sub-100ms response targets:

- **Zero-Latency Predictive Ghost Text**: Intelligent keystroke continuity. The engine tracks partial cache states against user input, instantly fast-forwarding and accurately slicing predictive text on every keystroke.
- **Parallel Context Matrix**: Deep project synchronization. Multi-file graph traversal, symbol impact isolation, and semantic structure detection are aggregated via parallelized background routines.
- **Dynamic Semantic Outdenting**: Deep awareness of structural code blocks. The system monitors live cursor indentation and halts prediction execution immediately upon detecting syntax scope termination.

## Core Capabilities

- **Autonomous Inline Completions**: Real-time generation powered by deterministic contextual rankers.
- **Speculative Prefetching**: Predicts likely next cursor positions and resolves completions in advance.
- **Project Learning**: Learns your architectural conventions natively.
- **Multi-Provider Connectivity**: Connect your local (Ollama) or remote (OpenAI, Anthropic) instances securely.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Version 18.x or higher)
- [VS Code](https://code.visualstudio.com/)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/AutoCode.git
   ```

2. **Initialize development environment**:
   ```bash
   npm run setup
   ```

3. **Launch Extension**:
   Press `F5` in VS Code to open the Extension Development Host.

## Configuration

| Key | Type | Description |
|-----|------|-------------|
| `autocode.enabled` | `boolean` | Activates the core engine services. |
| `autocode.provider` | `enum` | LLM provider (ollama, anthropic, openai, custom). |
| `autocode.model` | `string` | Specific model identifier (e.g., `qwen2.5-coder:1.5b`). |
| `autocode.streamingEnabled` | `boolean` | Enables real-time token streaming for zero latency. |
| `autocode.debounceMs` | `number` | Delay in milliseconds before triggering completion. |

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
