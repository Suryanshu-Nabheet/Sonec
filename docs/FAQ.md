# Frequently Asked Questions

### Is AutoCode free?
Yes, AutoCode is open-source. However, you are responsible for the costs associated with your chosen LLM provider (e.g., OpenAI API costs). Using Ollama allows for completely free, local inference.

### Which models work best?
We recommend models optimized for code, such as:
- **Ollama**: `qwen2.5-coder:1.5b` or `deepseek-coder:6.7b`.
- **OpenAI**: `gpt-4o`.
- **Anthropic**: `claude-3-5-sonnet`.

### How do I reduce latency?
- Use a local provider like Ollama with a small, quantized model.
- Enable **Streaming** in the settings.
- Adjust the **Debounce** time to match your typing speed.

### Can I use AutoCode offline?
Yes! By using **Ollama**, the entire engine runs locally on your machine without requiring an internet connection.

### Why did a suggestion disappear?
Suggestions disappear if you type something that doesn't match the predicted text, move the cursor away, or press `Esc`.

### How does "Agentic" context work?
AutoCode doesn't just look at the code; it looks at your project's state. It analyzes current compiler errors and missing imports to ensure the code it suggests is actually valid and runnable.
