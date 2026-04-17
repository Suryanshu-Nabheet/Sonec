# Getting Started with SONEC Development

Welcome! This guide will help you set up your environment to start contributing to SONEC.

## Steps to Launch

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/Suryanshu-Nabheet/Sonec.git
    cd Sonec
    ```

2.  **Run Setup**:
    This handles dependency installation and initial compilation.
    ```bash
    npm run setup
    ```

3.  **Open in VS Code**:
    ```bash
    code .
    ```

4.  **Configure a Model**:
    SONEC requires an LLM provider to function. We recommend **Ollama** for local development.
    - [Download Ollama](https://ollama.ai/)
    - Pull a coder model: `ollama pull qwen2.5-coder:1.5b`
    - Open VS Code Settings (`Cmd+,`), search for `SONEC`, and set:
        - `Provider`: `ollama`
        - `Model`: `qwen2.5-coder:1.5b`
        - `API Endpoint`: `http://localhost:11434`

5.  **Run & Debug**:
    Press `F5` (or go to Run and Debug view and click "Extension"). This launches a new VS Code window with SONEC active.

## Project Structure

- `src/`: TypeScript source code.
- `scripts/`: Utility scripts for setup, build, and launch.
- `docs/`: In-depth documentation.
- `out/`: Compiled JavaScript (generated).

## Common Tasks

- **Watch Mode**: Run `npm run watch` to recompile automatically on save.
- **Linting**: Run `npm run lint` to check for code style issues.
- **Testing**: Run `npm run test` to execute the suite of unit tests.
