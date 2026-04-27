# AutoCode Build & Development System

AutoCode is built with TypeScript and uses a set of shell scripts to manage the development lifecycle.

## Scripts Overview

The following scripts are located in the `/scripts` directory:

- **`setup.sh`**: Initializes the environment, installs npm dependencies, and runs the first compilation.
- **`rebrand.sh`**: A utility script for project-wide string replacement (e.g., updating namespaces or branding).
- **`clean.sh`**: Removes build artifacts (`/out`, `/dist`) and temporary logs.
- **`bundle.sh`**: Prepares a production-ready package for VSIX generation.

## Common Development Tasks

### Full Compilation
```bash
npm run compile
```
Uses `tsc` to compile the TypeScript source into the `out/` directory.

### Watch Mode
```bash
npm run watch
```
Starts the TypeScript compiler in watch mode for rapid development.

### Linting
```bash
npm run lint
```
Runs ESLint to ensure code quality and consistency with the project's style.

## Packaging
To generate a `.vsix` file for installation:
```bash
npm run package
```
Requires `vsce` to be installed globally or via devDependencies.
