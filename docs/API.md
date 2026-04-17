# SONEC Internal API Documentation

This document describes the key internal interfaces used by the SONEC engine.

## Core Engines

### `ContextEngine`
- `buildContext(document: TextDocument, position: Position, token: CancellationToken): Promise<ProjectContext>`
  - Assembles the full context for a completion request.
  - Automatically ranks and compresses context to fit token budgets.

### `PredictionEngine`
- `getCompletion(context: ProjectContext, token: CancellationToken): Promise<CompletionResult | null>`
  - Generates a single-file inline completion.
- `getTransformation(context: ProjectContext, userIntent?: string): Promise<ActionPlan | null>`
  - Generates multi-file architectural changes.

## Data Structures

### `ProjectContext`
The unified context object containing:
- `currentFile`: Cursor position and surrounding lines.
- `openFiles`: Snapshots of other open tabs.
- `symbols`: Current file symbol signatures.
- `gitDiffs`: Recent unstaged changes.
- `projectStyle`: Detected coding conventions.

### `ActionPlan`
A collection of atomic operations:
- `insert`: Add code at a position.
- `replace`: Replace a range with new code.
- `delete`: Remove a range.
- `create_file`: Create a new file with content.

## Model Providers

Providers are abstracted via the `ModelLayer`. To add a new provider:
1. Implement the `ModelProvider` interface.
2. Register it in `src/models/model-layer.ts`.
3. Update the global configuration schema in `package.json`.
