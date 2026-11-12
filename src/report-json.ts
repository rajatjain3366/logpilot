// JSON report (--format json): the same scan result as the text report, for tools to read.
//
// The output is stable: the same code gives byte-identical JSON on every run and every OS
// (fixed key order, sorted lists, "/" in paths, no timestamps). Incompatible changes to this
// shape will get a new schemaVersion, so tools can check what they are reading.

import type { ScanResult } from "./scanner.js";
import type { FailOn } from "./severity.js";
import type { Finding, ScanWarning, Severity } from "./types.js";

export const JSON_SCHEMA_VERSION = 1;

/** What the JSON report needs besides the scan result: settings, rules and the outcome. */
export interface JsonReportContext {
  toolVersion: string;
  rules: { id: string; name: string; version: number }[];
  config: {
    /** The config file used, as shown to the user, or null. */
    file: string | null;
    defaultExcludes: boolean;
    exclude: string[];
    minSeverity: Severity;
    failOn: FailOn;
  };
  /** The findings at or above minSeverity (the ones that are shown). */
  shown: Finding[];
  hiddenBelowMinSeverity: number;
  exitCode: number;
}

/** The JSON report as text, ending with a newline. */
export function formatJson(result: ScanResult, context: JsonReportContext): string {
  const count = (test: (s: ScanResult["skipped"][number]) => boolean) => result.skipped.filter(test).length;
  const report = {
    schemaVersion: JSON_SCHEMA_VERSION,
    tool: { name: "logpilot", version: context.toolVersion },
    rules: context.rules.map((rule) => ({ id: rule.id, name: rule.name, version: rule.version })),
    config: {
      file: context.config.file,
      defaultExcludes: context.config.defaultExcludes,
      exclude: [...context.config.exclude],
      minSeverity: context.config.minSeverity,
      failOn: context.config.failOn,
    },
    summary: {
      filesScanned: result.filesScanned,
      findings: context.shown.length,
      // Every known rule and every severity is listed, also with 0, so the keys never change.
      findingsByRule: Object.fromEntries(context.rules.map((rule) => [rule.id, context.shown.filter((f) => f.ruleId === rule.id).length])),
      findingsBySeverity: {
        high: context.shown.filter((f) => f.severity === "high").length,
        medium: context.shown.filter((f) => f.severity === "medium").length,
        low: context.shown.filter((f) => f.severity === "low").length,
      },
      hiddenBelowMinSeverity: context.hiddenBelowMinSeverity,
      suppressed: result.suppressed.length,
      skippedFiles: {
        minified: count((s) => s.kind === "file" && (s.reason === "minified-name" || s.reason === "minified-content")),
        vendored: count((s) => s.kind === "file" && s.reason === "vendored-banner"),
        userExclude: count((s) => s.kind === "file" && s.reason === "user-exclude"),
      },
      skippedFolders: {
        default: count((s) => s.kind === "folder" && s.reason === "default-folder"),
        userExclude: count((s) => s.kind === "folder" && s.reason === "user-exclude"),
      },
      filesWithSyntaxErrors: new Set(result.warnings.filter((w) => w.type === "syntax-error").map((w) => w.file)).size,
      warnings: result.warnings.length,
      exitCode: context.exitCode,
    },
    findings: context.shown.map(findingJson),
    suppressed: result.suppressed.map((s) => ({ finding: findingJson(s.finding), reason: s.reason, commentLine: s.commentLine })),
    skipped: result.skipped.map((s) => ({ path: s.path, kind: s.kind, reason: s.reason, detail: s.detail ?? null })),
    warnings: [...result.warnings].sort(compareWarnings).map((w) => ({
      type: w.type,
      file: w.file ?? null,
      line: w.line ?? null,
      message: w.message,
    })),
  };
  return JSON.stringify(report, null, 2) + "\n";
}

/** A finding with its keys always in the same order. */
function findingJson(f: Finding) {
  return {
    ruleId: f.ruleId,
    ruleName: f.ruleName,
    file: f.file,
    line: f.line,
    column: f.column,
    severity: f.severity,
    confidence: f.confidence,
    evidence: f.evidence,
    explanation: f.explanation,
    suggestion: f.suggestion,
  };
}

/** Warnings sorted by file, then line, then type and message, so the order never depends on timing. */
function compareWarnings(a: ScanWarning, b: ScanWarning): number {
  const keyA = [a.file ?? "", String(a.line ?? 0).padStart(9, "0"), a.type, a.message].join("\u0000");
  const keyB = [b.file ?? "", String(b.line ?? 0).padStart(9, "0"), b.type, b.message].join("\u0000");
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}
