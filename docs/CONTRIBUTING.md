# Contributing to AutoCode

Thank you for your interest in improving AutoCode! We welcome contributions that enhance the speed, accuracy, and agentic capabilities of the engine.

## Code of Conduct
Please be respectful and professional in all interactions. Our goal is to build the world's most advanced autonomous coding engine together.

## Development Workflow

1. **Fork and Clone**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/AutoCode.git
   ```
2. **Create a Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Set Up**:
   ```bash
   npm run setup
   ```
4. **Implement and Test**:
   Ensure your changes are well-documented and follow the existing architectural patterns.
5. **Submit a Pull Request**:
   Provide a detailed description of your changes and the problem they solve.

## Coding Standards

- **TypeScript**: Use strict typing and avoid `any` wherever possible.
- **Latency First**: Every new feature must be evaluated for its impact on end-to-end completion latency. Aim for <100ms.
- **Modularity**: Keep analyzers and tools decoupled. Use the `EventBus` for cross-component communication.
- **Documentation**: Update the relevant files in the `docs/` folder if you change the API or architecture.

## Areas for Contribution

- **New Agentic Tools**: Adding more tools to `src/tools` (e.g., test-aware context).
- **Inference Optimization**: Improving the `ModelLayer` for new providers.
- **UI/UX Improvements**: Enhancing the settings panel or ghost text rendering.
