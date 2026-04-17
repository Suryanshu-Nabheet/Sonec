# Contributing to SONEC

We're excited to have you contribute to the most advanced autonomous coding engine for VS Code!

## Development Environment Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/Sonec.git
   ```

2. **Run the setup script**:
   ```bash
   ./scripts/setup.sh
   ```

3. **Open in VS Code**:
   ```bash
   code .
   ```

## Running the Extension

- Press `F5` in VS Code to launch a "Extension Development Host" window.
- The extension logs can be viewed in the **Output** channel (select "SONEC Engine" from the dropdown).

## Code Standards

- **Professionalism**: No emojis or slang in the codebase or logs.
- **Documentation**: All new classes and public methods must have JSDoc.
- **Types**: Use strict TypeScript types. Avoid `any`.
- **Testing**: Add unit tests for new logic in `src/test/`.

## Pull Request Process

1. Create a feature branch from `main`.
2. Ensure your code compiles and passes lints (`npm run compile`, `npm run lint`).
3. Submit a PR with a detailed description of your changes.

## Architectural Guidelines

Before making major changes, please read the [Architecture Overview](./ARCHITECTURE.md).
