/**
 * SONEC Prompt Builder
 * 
 * Constructs highly optimized prompts for the model layer from ProjectContext.
 * Implements context compression, structure formatting, and instruction injection.
 * 
 * Key design: prompts are structured to elicit STRUCTURED ACTION output,
 * not raw text completions.
 */

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

    // System context
    sections.push(this.buildSystemSection());

    // Project style guide
    sections.push(this.buildStyleSection(context.projectStyle));

    // Related file signatures (compressed)
    if (context.relatedFiles.length > 0) {
      sections.push(this.buildRelatedFilesSection(context));
    }

    // Symbols in scope
    if (context.symbols.length > 0) {
      sections.push(this.buildSymbolsSection(context));
    }

    // Import context
    if (context.imports.length > 0) {
      sections.push(this.buildImportsSection(context));
    }

    // Recent edits (for continuity)
    if (context.recentEdits.length > 0) {
      sections.push(this.buildRecentEditsSection(context));
    }

    // Git diff context
    if (context.gitDiffs.length > 0) {
      sections.push(this.buildGitDiffSection(context));
    }

    // Current file with cursor position (most important — goes last)
    sections.push(this.buildCurrentFileSection(context));

    // Completion instruction
    sections.push(this.buildCompletionInstruction(context));

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

  // ─────────────────────────────────────────────────────────
  // Section Builders
  // ─────────────────────────────────────────────────────────

  private buildSystemSection(): string {
    return `You are SONEC, an autonomous code completion engine embedded in VS Code. Your output must be ONLY valid code that continues from the cursor position. Do not include explanations, markdown formatting, or code block markers. Output raw code only.`;
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

    return `<instruction>
Analyze the code and produce a structured edit plan as JSON.
Intent: ${intent}

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
</instruction>`;
  }

  private buildNextEditInstruction(): string {
    return `<instruction>
Based on the recent edit pattern in the code, predict the next location where the developer will need to make a change.

Output format:
{
  "predictions": [
    {
      "file": "relative/path",
      "line": N,
      "reason": "Brief explanation",
      "confidence": 0.85,
      "suggestedChange": "optional code snippet"
    }
  ]
}

Output ONLY valid JSON.
</instruction>`;
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
