/**
 * SONEC Prompt Builder
 * 
 * Constructs highly optimized prompts for the model layer from ProjectContext.
 * Implements context compression, structure formatting, and instruction injection.
 * 
 * Key design: prompts are structured to elicit STRUCTURED ACTION output,
 * not raw text completions.
 */

import * as vscode from 'vscode';
import {
  ProjectContext,
  ProjectStyle,
  StructuredAction,
} from '../core/types';
import { Logger } from '../core/logger';

export class PromptBuilder {
  private logger = Logger.getInstance();

  /**
   * Build a completion prompt for inline code completion
   */
  buildCompletionPrompt(context: ProjectContext): string {
    const sections: string[] = [];

    // System context (Role and constraints)
    sections.push(this.buildSystemSection());

    // Project style and metadata
    sections.push(this.buildStyleSection(context.projectStyle));

    // Related file signatures (compressed)
    if (context.relatedFiles.length > 0) {
      sections.push(this.buildRelatedFilesSection(context));
    }

    // Signatures and types (for symbol grounding)
    if (context.resolvedSignatures && context.resolvedSignatures.length > 0) {
        sections.push(`<signatures>\n${context.resolvedSignatures.join('\\n')}\n</signatures>`);
    }

    // Diagnostics (Critical for auto-fixing errors)
    if (context.diagnostics && context.diagnostics.length > 0) {
        sections.push(this.buildDiagnosticsSection(context.diagnostics));
    }

    // Symbols in scope
    if (context.symbols.length > 0) {
      sections.push(this.buildSymbolsSection(context));
    }

    // Git/Recent history (for trend awareness)
    if (context.gitDiffs.length > 0) {
      sections.push(this.buildGitDiffSection(context));
    }

    // Finally the code context in FIM format
    const cursor = context.currentFile;
    const fim = `<|fim_prefix|>${cursor.precedingLines}${cursor.linePrefix}<|fim_suffix|>${cursor.lineSuffix}${cursor.followingLines}<|fim_middle|>`;
    sections.push(fim);

    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * Build a transformation prompt for multi-file structured edits
   */
  buildTransformationPrompt(
    context: ProjectContext,
    userIntent?: string
  ): string {
    const sections: string[] = [];

    sections.push(this.buildSystemSection());
    sections.push(this.buildStyleSection(context.projectStyle));

    if (context.relatedFiles.length > 0) {
      sections.push(this.buildRelatedFilesSection(context));
    }

    sections.push(this.buildCurrentFileSection(context));
    sections.push(
      this.buildTransformationInstruction(context, userIntent)
    );

    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * Build a next-edit prediction prompt
   */
  buildNextEditPrompt(context: ProjectContext): string {
    const sections: string[] = [];

    sections.push(
      `You are an expert code prediction engine. Based on the developer's recent edits and current position, predict where they will need to edit next and what change they'll need to make.`
    );

    if (context.recentEdits.length > 0) {
      sections.push(this.buildRecentEditsSection(context));
    }

    sections.push(this.buildCurrentFileSection(context));
    sections.push(this.buildNextEditInstruction());

    return sections.filter(Boolean).join('\n\n');
  }

  private buildSystemSection(): string {
    return `You are SONEC, the world's most advanced autonomous coding engine. You specialize in low-latency code completion, surgical refactoring, and predictive navigation.
RULES:
1. Output ONLY the code to be inserted at the cursor.
2. NO markdown, NO explanations, NO code blocks.
3. Match the project's naming conventions and formatting EXACTLY.
4. Do NOT duplicate code already present in the suffix.`;
  }

  private buildStyleSection(style: ProjectStyle): string {
    const conventions = style.namingConventions;
    return `<style>
Indentation: ${style.indentation === 'spaces' ? `${style.indentSize} spaces` : 'tabs'}
Semicolons: ${style.semicolons ? 'yes' : 'no'}
Quotes: ${style.quoteStyle}
Trailing commas: ${style.trailingComma ? 'yes' : 'no'}
Variables: ${conventions.variables}
Functions: ${conventions.functions}
Classes: ${conventions.classes}
Constants: ${conventions.constants}
</style>`;
  }

  private buildRelatedFilesSection(context: ProjectContext): string {
    const fileSummaries = context.relatedFiles
      .map((f) => {
        const content = f.content.length > 500
          ? f.content.substring(0, 500) + '\n// ... (truncated)'
          : f.content;
        return `--- ${f.relativePath} (${f.languageId}) ---\n${content}`;
      })
      .join('\n\n');

    return `<related_files>\n${fileSummaries}\n</related_files>`;
  }

  private buildSymbolsSection(context: ProjectContext): string {
    const symbolList = context.symbols
      .slice(0, 40)
      .map((s) => {
        const kind = this.symbolKindName(s.kind);
        const container = s.containerName ? ` (in ${s.containerName})` : '';
        return `  ${kind}: ${s.name}${container}`;
      })
      .join('\n');

    return `<symbols_in_scope>\n${symbolList}\n</symbols_in_scope>`;
  }

  private buildImportsSection(context: ProjectContext): string {
    const importList = context.imports
      .map((imp) => {
        if (imp.isDefault) {
          return `import ${imp.importedSymbols[0]} from '${imp.moduleName}'`;
        }
        if (imp.isNamespace) {
          return `import * as ${imp.importedSymbols[0]} from '${imp.moduleName}'`;
        }
        return `import { ${imp.importedSymbols.join(', ')} } from '${imp.moduleName}'`;
      })
      .join('\n');

    return `<imports>\n${importList}\n</imports>`;
  }

  private buildRecentEditsSection(context: ProjectContext): string {
    const edits = context.recentEdits
      .slice(0, 10)
      .map((e) => {
        const preview = e.newText.length > 100
          ? e.newText.substring(0, 100) + '...'
          : e.newText;
        return `  ${e.file}:L${e.range.start.line} → "${preview}"`;
      })
      .join('\n');

    return `<recent_edits>\n${edits}\n</recent_edits>`;
  }

  private buildGitDiffSection(context: ProjectContext): string {
    const diffs = context.gitDiffs
      .slice(0, 3)
      .map((d) => {
        const hunkContent = d.hunks
          .slice(0, 2)
          .map((h) => h.content.substring(0, 200))
          .join('\n');
        return `--- ${d.filePath} ---\n${hunkContent}`;
      })
      .join('\n\n');

    return `<git_changes>\n${diffs}\n</git_changes>`;
  }

  private buildCurrentFileSection(context: ProjectContext): string {
    const cursor = context.currentFile;
    const signatures = (context.resolvedSignatures || []).join('\n');
    
    // FIM (Fill-In-The-Middle) pattern for Qwen2.5-Coder
    // <|file_separator|><|repo_name|>${context.projectName}<|file_path|>${cursor.file.relativePath}
    // ${signatures}
    // <|fim_prefix|>${cursor.precedingLines}${cursor.linePrefix}<|fim_suffix|>${cursor.lineSuffix}${cursor.followingLines}<|fim_middle|>
    return `<|fim_prefix|>${cursor.precedingLines}${cursor.linePrefix}<|fim_suffix|>${cursor.lineSuffix}${cursor.followingLines}<|fim_middle|>`;
  }

  private buildCompletionInstruction(context: ProjectContext): string {
    const cursor = context.currentFile;
    const hasPartialWord = cursor.linePrefix.match(/\w+$/);

    let instruction =
      'Continue the code from <cursor/>. Output ONLY the code that should appear after the cursor.';

    if (hasPartialWord) {
      instruction +=
        ` The cursor is in the middle of the word "${hasPartialWord[0]}", complete it naturally.`;
    }

    if (cursor.lineSuffix.trim()) {
      instruction +=
        ' Note there is existing code after the cursor — do not duplicate it.';
    }

    instruction += ` Do not emit more than ${50} lines. Do not include \`\`\` markers.`;

    return `<instruction>${instruction}</instruction>`;
  }

  private buildTransformationInstruction(
    context: ProjectContext,
    userIntent?: string
  ): string {
    const intent = userIntent || 'Complete or improve the code at the cursor position';
    const diagnostics = context.currentFile.file.uri ? vscode.languages.getDiagnostics(context.currentFile.file.uri) : [];
    const errorContext = diagnostics.length > 0 
      ? `\nDetected issues in current file:\n${diagnostics.map((d: vscode.Diagnostic) => `- [${d.range.start.line}:${d.range.start.character}] ${d.message}`).join('\n')}`
      : '';

    return `<instruction>
Analyze the code and produce a structured edit plan as JSON.
Intent: ${intent}${errorContext}

Output format:
{
  "reasoning": "Brief explanation of what changes are needed",
  "actions": [
    { "type": "insert", "file": "path", "position": { "line": N, "character": N }, "code": "...", "confidence": 0.95, "description": "..." },
    { "type": "replace", "file": "path", "range": { "startLine": N, "startCharacter": N, "endLine": N, "endCharacter": N }, "code": "...", "confidence": 0.9, "description": "..." },
    { "type": "delete", "file": "path", "range": { "startLine": N, "startCharacter": N, "endLine": N, "endCharacter": N }, "confidence": 0.85, "description": "..." }
  ]
}

Rules:
- Output ONLY valid JSON
- Actions should be logically ordered
- Include confidence scores (0-1)
- Be precise with line/character positions
- Cross-file edits are allowed
- If there are syntax or formatting issues, prioritize fixing them.
</instruction>`;
  }

  public buildRefactorPrompt(context: ProjectContext, issues: string[]): string {
    const sections: string[] = [];
    sections.push(this.buildSystemSection());
    sections.push(this.buildStyleSection(context.projectStyle));
    sections.push(this.buildCurrentFileSection(context));
    
    const issueBlock = `<detected_issues>\n${issues.join('\n')}\n</detected_issues>`;
    sections.push(issueBlock);
    
    sections.push(`<instruction>
You are an autonomous refactoring engine. Your goal is to fix the detected issues and improve the code quality.
Produce a structured edit plan as JSON with actions to fix these issues.
Output format same as transformation plan.
</instruction>`);

    return sections.filter(Boolean).join('\n\n');
  }

  private buildDiagnosticsSection(diagnostics: vscode.Diagnostic[]): string {
    const errorList = diagnostics
      .slice(0, 10)
      .map((d) => `  - [L${d.range.start.line + 1}] ${d.message} (${this.severityName(d.severity)})`)
      .join('\n');

    return `<diagnostics>\n${errorList}\n</diagnostics>`;
  }

  private severityName(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error: return 'Error';
      case vscode.DiagnosticSeverity.Warning: return 'Warning';
      case vscode.DiagnosticSeverity.Information: return 'Info';
      default: return 'Hint';
    }
  }

  private buildNextEditInstruction(): string {
    return `Output a JSON object with a "predictions" array. Each prediction MUST have:
- "file": relative path to the file
- "line": 0-indexed line number
- "type": "insert" | "delete" | "replace"
- "reason": detailed reasoning (e.g., "Fix missing semicolon", "Remove unused variable 'x'", "Implement missing return statement")
- "confidence": 0-1 score
- "suggestedChange": the EXACT code to insert or replace. For "delete", leave this empty. Use "replace" for all syntax fixes to ensure they are applied immediately upon jump.

SCENARIOS TO TARGET:
1. SYNTAX & LINT FIXES: Find missing symbols, typos, or style violations.
2. DEAD CODE REMOVAL: Find unused variables, imports, or unreachable code.
3. LOGICAL COMPLETION: Find the next necessary step in a sequence (e.g., after defining a function, predict its call or implementation).
4. REFACTORING: Identify opportunities to simplify or improve the current logic.

Format:
{"predictions": [{"file": "...", "line": 0, "type": "insert", "reason": "...", "confidence": 0.95, "suggestedChange": "..."}]}`;
  }

  public buildScaffoldPrompt(context: ProjectContext): string {
    const sections: string[] = [];
    sections.push(this.buildSystemSection());
    sections.push(`You are a software architect. Suggest the full boilerplate or next logical component for this project.`);
    sections.push(this.buildRelatedFilesSection(context));
    sections.push(this.buildCurrentFileSection(context));
    
    sections.push(`<instruction>
The file is empty or at its beginning. Suggest an extensive and complete code structure based on the project context.
Output ONLY raw code. Do not include explanations.
</instruction>`);

    return sections.filter(Boolean).join('\n\n');
  }

  private symbolKindName(kind: number): string {
    const names: Record<number, string> = {
      0: 'file',
      1: 'module',
      2: 'namespace',
      3: 'package',
      4: 'class',
      5: 'method',
      6: 'property',
      7: 'field',
      8: 'constructor',
      9: 'enum',
      10: 'interface',
      11: 'function',
      12: 'variable',
      13: 'constant',
      14: 'string',
      15: 'number',
      16: 'boolean',
      17: 'array',
      18: 'object',
      19: 'key',
      20: 'null',
      21: 'enum_member',
      22: 'struct',
      23: 'event',
      24: 'operator',
      25: 'type_parameter',
    };
    return names[kind] || 'symbol';
  }
}
