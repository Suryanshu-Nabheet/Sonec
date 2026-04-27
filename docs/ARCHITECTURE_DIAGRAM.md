# AutoCode Architecture Diagram

This diagram visualizes the interaction between the core components of the AutoCode engine.

```mermaid
graph TD
    User((User Typing)) -->|Trigger| Ext[Extension Entry Point]
    
    subgraph Context_Layer [Context Layer]
        Ext --> CE[Context Engine]
        CE --> SA[Symbol Analyzer]
        CE --> IA[Import Analyzer]
        CE --> GA[Git Analyzer]
        CE --> AT[Agentic Tools]
        AT --> DA[Diagnostic Analyzer]
        AT --> IT[Import Tool]
        AT --> DT[Definition Tool]
        AT --> HT[History Tool]
        AT --> PGT[Project Graph Tool]
        AT --> SUT[Symbol Usage Tool]
    end
    
    subgraph Prediction_Layer [Prediction Layer]
        CE -->|ProjectContext| PE[Prediction Engine]
        PE -->|Prompt| ML[Model Layer]
        ML -->|Inference| Prov[Provider: Ollama/OpenAI]
    end
    
    subgraph UI_Layer [UI Layer]
        Prov -->|Stream| CP[Completion Provider]
        CP -->|Ghost Text| VS[VS Code Editor]
    end
    
    VS -->|Accept/Dismiss| EB[Event Bus]
    EB --> PM[Performance Monitor]
    PM -->|Stats| SB[Status Bar]
```

## Component Roles

- **Context Layer**: Aggregates structural and semantic data about the project.
- **Prediction Layer**: Manages the LLM communication and caching.
- **UI Layer**: Handles the rendering of suggestions and user interactions.
- **Feedback Loop**: Tracks metrics to optimize future completions.
