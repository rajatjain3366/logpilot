// Tests for src/report-json.ts: the shape of the JSON report (schema version 3).
// Tools will read this format, so the keys, their order and the counts are checked exactly.

import { describe, expect, it } from "vitest";
import { formatJson, type JsonReportContext } from "../src/report-json.js";
import type { ScanResult } from "../src/scanner.js";
import type { Finding } from "../src/types.js";

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: "LP001",
    ruleName: "empty-catch",
    file: "src/a.js",
    line: 1,
    column: 1,
    severity: "medium",
    confidence: "high",
    evidence: "} catch {}",
    explanation: "why",
    suggestion: "what to do",
    ...overrides,
  };
}

const result: ScanResult = {
  filesScanned: 3,
  filesWithExpressHandlers: 2,
  findings: [finding({ line: 2 }), finding({ line: 9, severity: "low" })],
  suppressed: [{ finding: finding({ line: 20 }), reason: "the cache is optional", commentLine: 19 }],
  // Deliberately out of order: the JSON report must sort them.
  warnings: [
    { type: "syntax-error", file: "src/z.js", line: 4, message: "src/z.js: 1 syntax error" },
    { type: "unused-suppression", file: "src/a.js", line: 30, message: "src/a.js:30: unused" },
    { type: "unused-exclude", message: 'exclude pattern "x/**" matched nothing' },
  ],
  skipped: [
    { path: "dist", kind: "folder", reason: "default-folder" },
    { path: "public/app.min.js", kind: "file", reason: "minified-name", detail: "file name ends in .min.js" },
    { path: "public/big.js", kind: "file", reason: "minified-content", detail: "minified" },
    { path: "public/lib.js", kind: "file", reason: "vendored-banner", detail: "jQuery v3.7.1" },
  ],
};

const context: JsonReportContext = {
  toolVersion: "9.9.9",
  rules: [
    { id: "LP001", name: "empty-catch", version: 1 },
    { id: "LP002", name: "lost-error-cause", version: 3 },
  ],
  config: { file: null, defaultExcludes: true, exclude: ["docs/**"], minSeverity: "low", failOn: "none", fixPreview: false },
  shown: result.findings,
  hiddenBelowMinSeverity: 0,
  exitCode: 0,
};

describe("formatJson (schema version 3)", () => {
  it("is valid JSON with the top-level keys in a fixed order, ending with a newline", () => {
    const text = formatJson(result, context);

    expect(text.endsWith("}\n")).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      "schemaVersion",
      "tool",
      "rules",
      "config",
      "summary",
      "findings",
      "suppressed",
      "skipped",
      "warnings",
    ]);
  });

  it("names the schema version, the tool and every rule with its version", () => {
    const report = JSON.parse(formatJson(result, context));

    // CHANGED ON PURPOSE (Milestone 3): schema version 2 adds fix, config.fixPreview and summary.fixes.
    // CHANGED ON PURPOSE (v0.4.2): schema version 3: paths are relative to the scanned folder.
    expect(report.schemaVersion).toBe(3);
    expect(report.tool).toEqual({ name: "logpilot", version: "9.9.9" });
    expect(report.rules).toEqual([
      { id: "LP001", name: "empty-catch", version: 1 },
      { id: "LP002", name: "lost-error-cause", version: 3 },
    ]);
    // CHANGED ON PURPOSE (Milestone 3, schema version 2): config.fixPreview added.
    expect(report.config).toEqual({ file: null, defaultExcludes: true, exclude: ["docs/**"], minSeverity: "low", failOn: "none", fixPreview: false });
  });

  it("counts findings by rule and severity, listing rules and severities that have 0", () => {
    const { summary } = JSON.parse(formatJson(result, context));

    expect(summary).toEqual({
      filesScanned: 3,
      filesWithExpressHandlers: 2, // CHANGED ON PURPOSE (v0.4.2): key added (0 = LP003 had nothing to check)
      findings: 2,
      findingsByRule: { LP001: 2, LP002: 0 },
      findingsBySeverity: { high: 0, medium: 1, low: 1 },
      hiddenBelowMinSeverity: 0,
      suppressed: 1,
      skippedFiles: { minified: 2, vendored: 1, userExclude: 0 },
      skippedFolders: { default: 1, userExclude: 0 },
      filesWithSyntaxErrors: 1,
      warnings: 3,
      exitCode: 0,
      fixes: null, // CHANGED ON PURPOSE (Milestone 3, schema version 2): null without --fix-preview
    });
  });

  it("includes every field of a finding, and suppressed findings with their reason", () => {
    const report = JSON.parse(formatJson(result, context));

    expect(Object.keys(report.findings[0])).toEqual([
      "ruleId",
      "ruleName",
      "file",
      "line",
      "column",
      "severity",
      "confidence",
      "evidence",
      "explanation",
      "suggestion",
      "fix", // CHANGED ON PURPOSE (Milestone 3, schema version 2)
    ]);
    expect(report.findings[0].fix).toBeNull();
    expect(report.suppressed).toEqual([
      { finding: { ...finding({ line: 20 }), fix: null }, reason: "the cache is optional", commentLine: 19 },
    ]);
  });

  it("writes missing optional values as null, so every object has the same keys", () => {
    const report = JSON.parse(formatJson(result, context));

    expect(report.skipped[0]).toEqual({ path: "dist", kind: "folder", reason: "default-folder", detail: null });
    expect(report.warnings[0]).toEqual({
      type: "unused-exclude",
      file: null,
      line: null,
      message: 'exclude pattern "x/**" matched nothing',
    });
  });

  it("sorts warnings by file, then line, whatever order they were found in", () => {
    const report = JSON.parse(formatJson(result, context));

    expect(report.warnings.map((w: { file: string | null }) => w.file)).toEqual([null, "src/a.js", "src/z.js"]);
  });

  it("gives the same text for the same input", () => {
    expect(formatJson(result, context)).toBe(formatJson(structuredClone(result), structuredClone(context)));
  });
});

describe("formatJson: fix previews (schema version 2, Milestone 3)", () => {
  const withFix = finding({
    ruleId: "LP003",
    line: 6,
    fix: {
      status: "available",
      description: "Log the caught error with console.error just before the error response on line 7.",
      logger: { kind: "console", call: "console.error", confidence: "low", evidence: "no logger was found" },
      notes: [],
      edits: [{ start: 120, end: 120, newText: "    console.error(err);\n" }],
      diff: "--- a/src/a.js\n+++ b/src/a.js\n",
    },
  });
  const withoutFix = finding({ ruleId: "LP003", line: 30, fix: { status: "not-available", reason: "No fix for a 4xx answer.", notes: [], edits: [] } });
  const lp001 = finding({ line: 40, fix: { status: "not-available", reason: "No automatic fix for an empty catch.", notes: [], edits: [] } });
  const fixResult: ScanResult = { ...result, findings: [withFix, withoutFix, lp001], suppressed: [] };
  const fixContext: JsonReportContext = {
    ...context,
    rules: [...context.rules, { id: "LP003", name: "unlogged-error-response", version: 3 }],
    config: { ...context.config, fixPreview: true },
    shown: fixResult.findings,
  };
  const report = JSON.parse(formatJson(fixResult, fixContext));

  it("writes the whole fix with its keys in a fixed order, and null for missing values", () => {
    expect(report.config.fixPreview).toBe(true);
    expect(report.findings[0].fix).toEqual({
      status: "available",
      reason: null,
      description: "Log the caught error with console.error just before the error response on line 7.",
      logger: { kind: "console", call: "console.error", confidence: "low", evidence: "no logger was found" },
      notes: [],
      edits: [{ start: 120, end: 120, newText: "    console.error(err);\n" }],
      diff: "--- a/src/a.js\n+++ b/src/a.js\n",
    });
    expect(Object.keys(report.findings[0].fix)).toEqual(["status", "reason", "description", "logger", "notes", "edits", "diff"]);
    expect(report.findings[1].fix).toEqual({ status: "not-available", reason: "No fix for a 4xx answer.", description: null, logger: null, notes: [], edits: [], diff: null });
  });

  it("counts fixes for LP003 only (LP001's 'no fix' reason is listed, not counted)", () => {
    expect(report.summary.fixes).toEqual({ available: 1, notAvailable: 1 });
    expect(report.findings[2].fix.reason).toBe("No automatic fix for an empty catch.");
  });
});
