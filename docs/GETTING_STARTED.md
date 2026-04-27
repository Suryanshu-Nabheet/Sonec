# Getting Started with AutoCode

AutoCode is a high-performance autonomous code completion engine for VS Code. Follow this guide to set up your environment and start using the extension.

## Prerequisites

- **Node.js**: Version 18.x or higher.
- **VS Code**: Version 1.85.0 or higher.
- **LLM Provider**: One of the following:
  - **Ollama** (Local): Download from [ollama.com](https://ollama.com/).
  - **OpenAI**: API Key required.
  - **Anthropic**: API Key required.

## Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/Suryanshu-Nabheet/AutoCode.git
   ```

2. **Setup Dependencies**:
   ```bash
   npm run setup
   ```

3. **Launch the Extension**:
   - Open the project folder in VS Code.
   - Press `F5` to launch the **Extension Development Host**.

## Configuration

Once the extension is launched, you need to configure your model provider:

1. Open the **AutoCode Settings** by clicking the gear icon in the status bar or running the `AutoCode: Open Settings` command.
2. Select your **Provider** (e.g., Ollama, OpenAI).
3. Enter your **API Key** (if applicable).
4. Specify the **Model** (e.g., `qwen2.5-coder:1.5b` for Ollama).
5. Click **Save**.

## Using AutoCode

AutoCode works automatically as you type. Here are the core interactions:

- **Inline Suggestions**: As you type, ghost text will appear. Press `Tab` to accept the full suggestion.
- **Partial Acceptance**:
  - `Cmd+RightArrow`: Accept the next word.
  - `Cmd+Shift+RightArrow`: Accept the next line.
- **Manual Trigger**: Press `Ctrl+Space` if a suggestion doesn't appear automatically.
- **Dismissal**: Press `Esc` to hide the current suggestion.

## Troubleshooting

- **Check Status**: Use the `AutoCode: Check Status` command to verify connectivity to your LLM provider.
- **View Logs**: Check the `AutoCode` output channel for detailed diagnostic logs.
