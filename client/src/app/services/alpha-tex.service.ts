import { Injectable } from '@angular/core';
import * as alphaTab from '@coderline/alphatab';
import { TexDiagnostic } from '../models/composer.model';

export interface TexParseResult {
  /** null when parsing failed. The caller keeps its last good document. */
  score: alphaTab.model.Score | null;
  diagnostics: TexDiagnostic[];
}

/**
 * Wraps alphaTab's own alphaTex importer and exporter.
 *
 * The composer does not hand-write alphaTex. alphaTab ships a parser (with
 * positioned diagnostics) and an exporter, so tex is generated and consumed by
 * the library itself and is canonical by construction. A parse/export/parse
 * cycle is byte-stable.
 */
@Injectable({ providedIn: 'root' })
export class AlphaTexService {
  private readonly settings = new alphaTab.Settings();

  /** Serializes a score to canonical alphaTex. */
  export(score: alphaTab.model.Score): string {
    return new alphaTab.exporter.AlphaTexExporter().exportToString(score, this.settings);
  }

  /**
   * Parses alphaTex. On failure `score` is null and `diagnostics` explains why,
   * with source positions suitable for an editor gutter.
   */
  parse(tex: string): TexParseResult {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.logErrors = false;

    try {
      importer.initFromString(tex, this.settings);
      const score = importer.readScore();
      return { score, diagnostics: this.collectDiagnostics(importer) };
    } catch (error) {
      return { score: null, diagnostics: this.diagnosticsFromError(error) };
    }
  }

  /** Non-fatal diagnostics from a successful parse (warnings, hints). */
  private collectDiagnostics(importer: alphaTab.importer.AlphaTexImporter): TexDiagnostic[] {
    return [
      ...this.fromBag(importer.lexerDiagnostics),
      ...this.fromBag(importer.parserDiagnostics),
      ...this.fromBag(importer.semanticDiagnostics)
    ];
  }

  private diagnosticsFromError(error: unknown): TexDiagnostic[] {
    const cause = this.extractDiagnosticSource(error);
    if (!cause) {
      const message = error instanceof Error ? error.message : 'Failed to parse alphaTex';
      return [{ severity: 'error', code: 0, message, line: 1, column: 1 }];
    }

    const diagnostics = [
      ...this.fromBag(cause.lexerDiagnostics),
      ...this.fromBag(cause.parserDiagnostics),
      ...this.fromBag(cause.semanticDiagnostics)
    ];

    return diagnostics.length > 0
      ? diagnostics
      : [{ severity: 'error', code: 0, message: 'Failed to parse alphaTex', line: 1, column: 1 }];
  }

  private extractDiagnosticSource(error: unknown): {
    lexerDiagnostics?: unknown;
    parserDiagnostics?: unknown;
    semanticDiagnostics?: unknown;
  } | null {
    // alphaTab wraps the diagnostics-bearing error in `cause`.
    const candidates = [error, (error as { cause?: unknown })?.cause];
    for (const candidate of candidates) {
      if (
        candidate &&
        typeof candidate === 'object' &&
        ('parserDiagnostics' in candidate ||
          'lexerDiagnostics' in candidate ||
          'semanticDiagnostics' in candidate)
      ) {
        return candidate as Record<string, unknown>;
      }
    }
    return null;
  }

  private fromBag(bag: unknown): TexDiagnostic[] {
    const items = (bag as { items?: unknown })?.items;
    if (!Array.isArray(items)) return [];

    return items.map(item => {
      const entry = item as {
        code?: number;
        message?: string;
        severity?: number;
        start?: { line?: number; col?: number };
      };
      return {
        severity: this.toSeverity(entry.severity),
        code: entry.code ?? 0,
        message: this.truncate(entry.message ?? 'Unknown problem'),
        line: entry.start?.line ?? 1,
        column: entry.start?.col ?? 1
      };
    });
  }

  private toSeverity(severity: number | undefined): TexDiagnostic['severity'] {
    switch (severity) {
      case 2: return 'error';
      case 1: return 'warning';
      default: return 'info';
    }
  }

  /**
   * Some alphaTab messages enumerate every valid value (the percussion
   * articulation list runs to several thousand characters), which is unusable
   * in a gutter. Keep the useful head of the message.
   */
  private truncate(message: string, limit = 240): string {
    if (message.length <= limit) return message;
    return `${message.slice(0, limit).trimEnd()}...`;
  }
}
