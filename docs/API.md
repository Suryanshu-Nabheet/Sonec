# AutoCode Internal API Documentation

While AutoCode is primarily used as a VS Code extension, its internal modules are structured as a library for modularity and testability.

## Core Modules

### `ContextEngine`
Source: `src/context/context-engine.ts`

**Method**: `buildContext(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<ProjectContext>`
- Assembles a full context object including surrounding code, related files, and agentic tool outputs.

### `PredictionEngine`
Source: `src/prediction/prediction-engine.ts`

**Method**: `getCompletion(document: vscode.TextDocument, position: vscode.Position, context: ProjectContext, token: vscode.CancellationToken): Promise<CompletionResult | null>`
- The main entry point for generating a completion. Handles caching and model layer orchestration.

### `ModelLayer`
Source: `src/models/model-layer.ts`

**Method**: `generate(request: ModelRequest, callback?: StreamCallback): Promise<ModelResponse>`
- Unified interface for all LLM providers. Supports streaming and non-streaming requests.

## Event System
AutoCode uses a centralized `EventBus` for telemetry and component synchronization.

| Event Type | Data Description |
|------------|------------------|
| `completion_triggered` | File path and cursor position. |
| `completion_shown` | Completion ID and confidence score. |
| `completion_accepted` | Completion ID and whether it was partial. |
| `completion_dismissed` | Reason for dismissal (e.g., user typed different text). |
| `context_rebuilt` | Token count and gathering latency. |

## Agentic Tools
Source: `src/tools/`

- **`DiagnosticAnalyzer.analyzeDiagnostics()`**: Returns structured error information.
- **`ImportTool.getImportPrompt()`**: Returns suggestions for missing imports.
- **`DefinitionTool.resolveDefinition()`**: Fetches signatures for symbols at position.
