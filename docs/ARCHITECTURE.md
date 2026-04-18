# SONEC Architecture Overview

SONEC (Structured Omniscient Neural Editor & Compiler) operates via an aggressively optimized, event-driven graph architecture targeting absolute zero-latency execution.

## Core Systems

### 1. Context Engine (`src/context/`)
The foundational data layer. Operations in this engine are strictly parallelized to eliminate compounding I/O latency.
- **Symbol Analyzer**: Captures localized semantics and document hierarchy.
- **Import Mapping**: Topologically links required external or intra-repository dependencies.
- **Git State Analyzer**: Injects temporal diff awareness.
- **Semantic Resolver**: Performs complex cross-module lookup resolving execution dependencies simultaneously alongside local context parsing.

### 2. Prediction Engine (`src/prediction/`)
The algorithmic reasoning module. It translates parallelized context graphs into direct syntactic suggestions.
- **Token Optimization**: Enforces stringent token boundaries tailored precisely to line depth, averting over-generation blocking behavior.
- **Semantic Stop Sequences**: Actively reads local cursor indentation to inject dynamic exit tokens, physically halting model generation exactly when block scope falls out of boundary.
- **Speculative Pathing**: Evaluates cursor trajectory to generate prefetch vectors for proactive completions.

### 3. Edge Presentation (`src/providers/`)
The `SonecCompletionProvider` handles seamless VS Code integration.
- **Fast-Forward Proxy**: Enables continuous typing validation. Scans user input against in-memory completion caches, visually trimming and injecting output immediately to achieve `0ms` response times.
- **Stealth Integration**: Exists outside of the VS Code notification daemon to eliminate all disruptive status messages.

### 4. Execution Engine (`src/execution/`)
Manages safe application environments.
- **Atomic Application**: Commits predictions across an N-file topology.
- **Transactional Rollback**: Backs up edits allowing absolute reversal of severe operational errors.

### 5. Model Abstraction (`src/models/`)
Provider interface layer (OpenAI, Anthropic, Ollama) engineered to support strict cancellation routines, request caching arrays, and raw response streaming.

## Operational Lifecycle

1. **Keystroke / Cursor Mutation**: Fired natively via VS Code abstractions. 
2. **Fast-Forward Evaluation**: Checks memory caches for overlapping token trajectories. On hit, visual update completes in `< 1ms`.
3. **Parallel Discovery**: On miss, `ContextEngine` blasts out multiple concurrent analysis requests globally.
4. **Targeted Inference**: `PredictionEngine` caps response size and triggers language model socket.
5. **Real-time Splice**: `SonecCompletionProvider` mounts the sequence onto the ghost text layer visually blocking further network noise.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for deeper workflow implementation guidelines.
