# SONEC Architecture Overview

SONEC (Structured Omniscient Neural Editor & Compiler) is an autonomous code engine designed for high-performance, context-aware code generation.

## Core Components

### 1. Context Engine (`src/context/`)
The Context Engine is responsible for gathering all relevant information before a prediction is made. It uses several specialized analyzers:
- **Symbol Analyzer**: Extracts structural information (classes, functions, methods) from the current file.
- **Import Analyzer**: Resolves dependencies and understands external library usage.
- **Git Analyzer**: Provides temporal context by analyzing recent changes and diffs.
- **Project Graph**: Maintains an architectural overview of the entire workspace.

### 2. Prediction Engine (`src/prediction/`)
The "brain" of SONEC. It takes the ranked context from the Context Engine and translates it into:
- **Inline Completions**: Real-time code suggestions as you type.
- **Action Plans**: Multi-file transformations and refactors.
- **Trajectory Tracking**: Predicts the developer's next move based on historical edits.

### 3. Execution Engine (`src/execution/`)
Handles the safe application of predicted changes.
- **Action Execution**: Applies `ActionPlans` atomically.
- **Undo Management**: Allows developers to revert complex multi-file changes instantly.

### 4. Model Layer (`src/models/`)
Abstractions over various LLM providers (Ollama, OpenAI, Anthropic). It handles:
- **Prompt Building**: Transforming raw context into highly effective prompts.
- **Streaming**: Delivering completions chunk-by-chunk for zero perceived latency.

## Data Flow

1. **Trigger**: User types or moves cursor (detected in `extension.ts`).
2. **Context Assembly**: `ContextEngine` gathers data from analyzers.
3. **Inference**: `PredictionEngine` calls `ModelLayer` with optimized prompts.
4. **Caching**: Results are stored in `CompletionCache` for sub-millisecond retrieval on repeat requests.
5. **Display**: suggestions are shown via `SonecCompletionProvider`.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details on how to get started.
