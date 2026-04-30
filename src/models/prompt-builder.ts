/**
 * AutoCode Prompt Builder
 * 
 * Constructs highly optimized prompts for the model layer from ProjectContext.
 * Enriched with super-advanced agentic tool outputs (diagnostics, imports, definitions,
 * history, project relationships, and symbol usage).
 */

import * as vscode from 'vscode';
import {
  ProjectContext,
  ProjectStyle,
} from '../core/types';
import { Logger } from '../core/logger';

export class PromptBuilder {
  private logger = Logger.getInstance();

  /**
   * Build a completion prompt for inline code completion
   */
  buildCompletionPrompt(context: ProjectContext): string {
    const sections: string[] = [];

    // 0. System instructions
    sections.push(this.buildSystemSection());

    // 1. High-Priority: Symbols & Signatures (Technical Constraints)
    if (context.resolvedSignatures && context.resolvedSignatures.length > 0) {
        sections.push(`<signatures>\n${context.resolvedSignatures.join('\n')}\n</signatures>`);
    }
    if (context.symbols.length > 0) {
        sections.push(this.buildSymbolsSection(context));
    }

    // 2. Middle-Priority: Related Code & History (Contextual Clues)
    if (context.relatedFiles.length > 0) {
      sections.push(this.buildRelatedFilesSection(context));
    }
    if (context.fileHistory) {
      sections.push(context.fileHistory);
    }

    // 3. Low-Priority: Diagnostics & Edits (Correctional Clues)
    if (context.diagnosticSummary) {
      sections.push(context.diagnosticSummary);
    }
    if (context.recentEdits.length > 0) {
        sections.push(this.buildRecentEditsSection(context));
    }

    // 4. Style & Constraints
    sections.push(this.buildStyleSection(context.projectStyle));

    // 5. THE CORE: FIM (Fill-In-the-Middle)
    const cursor = context.currentFile;
    const fim = `<|fim_prefix|>${cursor.precedingLines}${cursor.linePrefix}<|fim_suffix|>${cursor.lineSuffix}${cursor.followingLines}<|fim_middle|>`;
    sections.push(fim);

    return sections.filter(Boolean).join('\n\n');
  }

  private buildSystemSection(): string {
    return `You are AutoCode, the world's most accurate autonomous coding engine.
Context is provided in XML tags. Use it to predict the MOST LIKELY code to follow the prefix.

STRICT RULES:
- Return ONLY the code to insert.
- NO markdown, NO code blocks.
- Match existing indentation and style perfectly.
- STOP if you reach the next logical block or duplicate suffix code.`;
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

  private buildRecentEditsSection(context: ProjectContext): string {
      const edits = context.recentEdits
        .slice(-5)
        .map(e => `- ${e.file}: "${e.newText.trim()}"`)
        .join('\n');
      return `<recent_session_edits>\n${edits}\n</recent_session_edits>`;
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
