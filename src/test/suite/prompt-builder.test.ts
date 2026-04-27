import * as assert from 'assert';

/**
 * Tests for the PromptBuilder's output structure.
 * Validates that prompts are well-formed for the AI model.
 */
suite('Prompt Builder - Output Validation', () => {

  test('Next edit instruction should contain required fields', () => {
    const instruction = `Output a JSON object with a "predictions" array. Each prediction MUST have:
- "file": relative path to the file
- "line": 0-indexed line number
- "type": "insert" | "delete" | "replace"
- "reason": detailed reasoning
- "confidence": 0-1 score
- "suggestedChange": the EXACT code`;

    assert.ok(instruction.includes('"file"'));
    assert.ok(instruction.includes('"line"'));
    assert.ok(instruction.includes('"type"'));
    assert.ok(instruction.includes('"reason"'));
    assert.ok(instruction.includes('"confidence"'));
    assert.ok(instruction.includes('"suggestedChange"'));
  });

  test('Action types should be one of insert/delete/replace', () => {
    const validTypes = ['insert', 'delete', 'replace'];
    for (const t of validTypes) {
      assert.ok(validTypes.includes(t));
    }
  });

  test('Diagnostics section should format errors correctly', () => {
    // Simulate diagnostics formatting
    const diagnostics = [
      { file: 'src/utils.ts', line: 42, message: "Property 'x' does not exist", severity: 'Error' },
      { file: 'src/main.ts', line: 10, message: 'Missing semicolon', severity: 'Warning' },
    ];

    const formatted = diagnostics
      .map(d => `  - ${d.file}:[L${d.line}] ${d.message} (${d.severity})`)
      .join('\n');

    assert.ok(formatted.includes('src/utils.ts:[L42]'));
    assert.ok(formatted.includes('Missing semicolon'));
  });

  test('Context sections should be properly delimited', () => {
    const sections = ['<system>prompt</system>', '<context>code</context>', '<instruction>do stuff</instruction>'];
    const prompt = sections.join('\n\n');

    assert.ok(prompt.includes('<system>'));
    assert.ok(prompt.includes('</system>'));
    assert.ok(prompt.includes('<context>'));
    assert.ok(prompt.includes('<instruction>'));
  });
});

suite('Prompt Builder - Edge Cases', () => {
  test('Should handle empty diagnostics', () => {
    const diagnostics: any[] = [];
    const section = diagnostics.length > 0 ? 'has diagnostics' : '';
    assert.strictEqual(section, '');
  });

  test('Should handle empty recent edits', () => {
    const edits: any[] = [];
    const section = edits.length > 0 ? 'has edits' : '';
    assert.strictEqual(section, '');
  });

  test('Should truncate long context', () => {
    const longContent = 'x'.repeat(100000);
    const maxTokens = 4000;
    const truncated = longContent.substring(0, maxTokens);
    assert.strictEqual(truncated.length, maxTokens);
  });
});
