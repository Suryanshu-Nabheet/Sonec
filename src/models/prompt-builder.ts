/**
 * AutoCode Prompt Builder
 * 
 * Constructs highly optimized prompts for the model layer from ProjectContext.
 * Enriched with agentic tool outputs (diagnostics, imports, definitions).
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

    // System context
    sections.push(this.buildSystemSection());

    // Project style
    sections.push(this.buildStyleSection(context.projectStyle));

    // Agentic Sections: Diagnostics & Issues
    if (context.diagnosticSummary) {
      sections.push(context.diagnosticSummary);
    }

    // Agentic Sections: Import Suggestions
    if (context.importSuggestions) {
      sections.push(context.importSuggestions);
    }

    // Agentic Sections: Resolved Definitions
    if (context.resolvedDefinitions) {
      sections.push(context.resolvedDefinitions);
    }

    // Related file signatures
    if (context.relatedFiles.length > 0) {
      sections.push(this.buildRelatedFilesSection(context));
    }

    // Signatures and types
    if (context.resolvedSignatures && context.resolvedSignatures.length > 0) {
        sections.push(`<signatures>\n${context.resolvedSignatures.join('\n')}\n</signatures>`);
    }

    // Symbols in scope
    if (context.symbols.length > 0) {
      sections.push(this.buildSymbolsSection(context));
    }

    // Git history
    if (context.gitDiffs.length > 0) {
      sections.push(this.buildGitDiffSection(context));
    }

    // FIM context
    const cursor = context.currentFile;
    const fim = `<|fim_prefix|>${cursor.precedingLines}${cursor.linePrefix}<|fim_suffix|>${cursor.lineSuffix}${cursor.followingLines}<|fim_middle|>`;
    sections.push(fim);

    return sections.filter(Boolean).join('\n\n');
  }

  private buildSystemSection(): string {
    return `You are AutoCode, the world's most advanced autonomous coding engine. You specialize in low-latency code completion.
You are "agentic" and aware of current syntax errors, missing imports, and type definitions provided in the context.
Use this information to suggest code that FIXES current issues and follows project patterns.

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
