# AutoCode Architecture

AutoCode is designed for sub-100ms latency and high contextual accuracy. It uses a modular architecture that separates context gathering, model inference, and UI rendering.

## High-Level Components

### 1. Context Engine (`src/context`)
The "brain" of the extension. it aggregates information from multiple sources:
- **CursorContext**: Immediate lines around the cursor.
- **RelatedFiles**: Uses import analysis to find semantically linked files.
- **Agentic Tools**: 
  - `DiagnosticAnalyzer`: Injects current syntax errors into the prompt.
  - `ImportTool`: Resolves missing dependencies.
  - `DefinitionTool`: Fetches type signatures for symbols at the cursor.
  - `HistoryTool`: Provides context from Git commit history.
  - `ProjectGraphTool`: Maps non-obvious file relationships based on naming patterns.
  - `SymbolUsageTool`: Finds cross-file usage examples for symbols.

### 2. Prediction Engine (`src/prediction`)
Manages the lifecycle of a completion request:
- **Debouncing**: Prevents excessive API calls.
- **Caching**: Uses a multi-tier LRU cache for instant retrieval.
- **Streaming**: Orchestrates real-time ghost text rendering as tokens arrive.

### 3. Model Layer (`src/models`)
The abstraction for LLM providers:
- **ModelLayer**: Unified interface for OpenAI, Anthropic, and Ollama.
- **PromptBuilder**: Constructs FIM (Fill-In-the-Middle) prompts enriched with agentic tool metadata.

### 4. Event Bus (`src/core/event-bus.ts`)
A centralized messaging system that allows decoupled components to react to state changes (e.g., `completion_accepted`, `context_rebuilt`).

## Data Flow

1. **Trigger**: User types or moves cursor.
2. **Context Gathering**: `ContextEngine` runs analyzers and agentic tools in parallel.
3. **Prompt Construction**: `PromptBuilder` formats the context into a FIM prompt.
4. **Inference**: `ModelLayer` sends the request to the configured provider.
5. **Rendering**: `PredictionEngine` streams the result to the `AutoCodeCompletionProvider`.
6. **Feedback Loop**: Acceptance/Dismissal events are logged to the `PerformanceMonitor`.

## Latency Optimization Strategies

- **Parallelism**: Context analyzers run concurrently using `Promise.all`.
- **Stateless Prediction**: Each completion request is self-contained but informed by cached history.
- **Early Termination**: Predictions are halted immediately if the model generates a scope-terminating character (e.g., a closing brace at a lower indentation).
