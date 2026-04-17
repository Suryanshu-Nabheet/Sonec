# Frequently Asked Questions (FAQ)

## Why doesn't the extension trigger suggestions?

1. **Check Enabled State**: Ensure `sonec.enabled` is set to `true` in your VS Code settings.
2. **Model Provider**: Verify that your provider is correctly configured (e.g., Ollama is running, or your API key is valid).
3. **Log Output**: Check the "SONEC Engine" output channel for error messages.

## How do I use a custom local model?

1. Set `sonec.provider` to `custom` or `ollama`.
2. Set `sonec.apiEndpoint` to your local server (e.g., `http://localhost:11434`).
3. Set `sonec.model` to the model tag (e.g., `llama3`).

## Can I undo multi-file changes?

Yes! SONEC maintains a transaction-safe undo stack. When a multi-file transformation is applied, a standard VS Code undo (`Cmd+Z` / `Ctrl+Z`) in any of the modified files will trigger a confirmation to revert the entire plan.

## Is my code shared with external servers?

Only if you use a cloud-based provider like OpenAI or Anthropic. If you use Ollama, all processing remains strictly local on your machine.
