# SONEC Build System Documentation

SONEC uses a standard TypeScript-based build pipeline optimized for VS Code extension development.

## Pipeline Overview

1.  **Preprocessing**: VS Code settings and `package.json` configurations are validated.
2.  **Compilation**: `tsc` (TypeScript Compiler) transforms `.ts` files in `src/` to `.js` files in `out/`.
3.  **Publishing (Production)**: `vsce` is used to package the extension into a `.vsix` bundle.

## Key Build Scripts

- `npm run compile`: Runs a single compilation pass.
- `npm run watch`: Runs the compiler in watch mode for real-time development.
- `npm run package`: Generates the production `.vsix` file for distribution.
- `npm run setup`: Initializes the environment (dependency install + first compile).

## Dependency Management

We use `npm` for dependency management.
- **Production Dependencies**: Libraries bundled with the extension (e.g., `lru-cache`, `web-tree-sitter`).
- **Development Dependencies**: Tools for compilation, linting, and testing (e.g., `typescript`, `eslint`, `mocha`).

## Tree-Sitter Integration

SONEC utilizes `web-tree-sitter` for high-performance syntax analysis.
Note: Web-assembly (`.wasm`) files for supported languages must be correctly mapped in the `package.json` or downloaded during setup to enable deep structural analysis.
