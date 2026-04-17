# SONEC Architecture Diagram

This diagram visualizes the data flow and system interactions within the SONEC autonomous coding engine.

```mermaid
graph TD
    User([User Coding]) -->|Types/Moves| Extension[extension.ts]
    
    subgraph Core_Engine [SONEC Core Engine]
        Extension -->|Debounced Trigger| CE[Context Engine]
        CE -->|Parallel Scan| Analyzers[Analyzers: Symbol, Git, Import, Style]
        Analyzers -->|Context Data| Ranker[Context Ranker]
        Ranker -->|ProjectContext| PE[Prediction Engine]
        
        PE -->|PromptBuilder| Prompt[Optimized LLM Prompt]
        Prompt -->|Inference Request| ML[Model Layer]
        
        ML -->|Streaming Response| PE
        PE -->|Processed Output| CP[Completion Provider]
    end
    
    subgraph Action_Execution [Action execution]
        PE -->|ActionPlan| AE[Action Execution Engine]
        AE -->|Atomic Apply| FileSystem[(FileSystem)]
        AE -->|Record Undo| UndoStack[Undo Strategy Manager]
    end
    
    CP -->|Inline Suggestion| User
    
    subgraph Data_Storage [Optimization Layer]
        PE <-->|Save/Load| Cache[(Completion Cache)]
        CE <-->|Trajectory| TE[Trajectory Engine]
    end
```

## Description

1.  **Trigger Layer**: Monitors VS Code events and manages the activation of the engine.
2.  **Context Layer**: Dynamically resolves the project structure, language symbols, and recent developer history to build a deep understanding of the current task.
3.  **Intelligence Layer**: Orchestrates LLM interactions, streaming results, and calculating speculative edits using trajectory analysis.
4.  **Execution Layer**: Manages complex, multi-file code transformations with high reliability and transaction safety.
