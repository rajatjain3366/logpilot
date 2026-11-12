// JSON report (--format json): the same scan result as the text report, for tools to read.
//
// The output is stable: the same code gives byte-identical JSON on every run and every OS
// (fixed key order, sorted lists, "/" in paths, no timestamps).
//
// Versioning policy (from schema version 2 on):
// - Adding a key does NOT change schemaVersion. Tools reading the report should ignore keys they
//   do not know.
// - Removing or renaming a key, or changing what a key means or what values it can hold, DOES
//   change schemaVersion.
// Version 2 (Milestone 3): every finding has a `fix` key, config has `fixPreview`, and the summary
// has `fixes`. Version 1 promised that every object always has all its keys, so a reader could
// check the exact set; that is why adding these keys changed the version this one time.
// Version 3 (v0.4.2): every path (`file`, `path`, `config.file`, the paths in `diff`) is relative
// to the scanned folder (for a single file: its folder). Before, paths were relative to the folder
// LogPilot was run from, so they changed with it; that changes which values these keys hold.
// Also added: `summary.filesWithExpressHandlers`.

import { FIXABLE_RULES } from "./fixes.js";
import type { ScanResult } from "./scanner.js";
import type { FailOn } from "./severity.js";
import type { Finding, FixPreview, ScanWarning, Severity } from "./types.js";

export const JSON_SCHEMA_VERSION = 3;

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
    /** The scan ran with --fix-preview. */
    fixPreview: boolean;
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
      fixPreview: context.config.fixPreview,
    },
    summary: {
      filesScanned: result.filesScanned,
      // 0 means LP003 (and fix previews) had nothing to check: it looks at Express handlers only.
      filesWithExpressHandlers: result.filesWithExpressHandlers,
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
      // null without --fix-preview (nothing was tried); counts only rules that can have fixes (LP003).
      fixes: context.config.fixPreview ? fixCounts(context.shown) : null,
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
    fix: f.fix === undefined ? null : fixJson(f.fix),
  };
}

/** A proposed fix with its keys always in the same order; missing values are null. */
function fixJson(fix: FixPreview) {
  return {
    status: fix.status,
    reason: fix.reason ?? null,
    description: fix.description ?? null,
    logger:
      fix.logger === undefined
        ? null
        : { kind: fix.logger.kind, call: fix.logger.call, confidence: fix.logger.confidence, evidence: fix.logger.evidence },
    notes: [...fix.notes],
    edits: fix.edits.map((edit) => ({ start: edit.start, end: edit.end, newText: edit.newText })),
    diff: fix.diff ?? null,
  };
}

/** How many shown findings of rules with fixes have a fix, and how many do not. */
function fixCounts(shown: Finding[]): { available: number; notAvailable: number } {
  const fixable = shown.filter((f) => FIXABLE_RULES.has(f.ruleId) && f.fix !== undefined);
  const available = fixable.filter((f) => f.fix?.status === "available").length;
  return { available, notAvailable: fixable.length - available };
}

/** Warnings sorted by file, then line, then type and message, so the order never depends on timing. */
function compareWarnings(a: ScanWarning, b: ScanWarning): number {
  const keyA = [a.file ?? "", String(a.line ?? 0).padStart(9, "0"), a.type, a.message].join("\u0000");
  const keyB = [b.file ?? "", String(b.line ?? 0).padStart(9, "0"), b.type, b.message].join("\u0000");
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}
