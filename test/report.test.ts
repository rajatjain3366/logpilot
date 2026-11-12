// Tests for the text report format.

import { describe, expect, it } from "vitest";
import { formatReport } from "../src/report.js";
import type { Finding, SkippedPath } from "../src/types.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: "LP001",
    ruleName: "empty-catch",
    file: "src/a.ts",
    line: 9,
    column: 5,
    severity: "high",
    confidence: "medium",
    evidence: "  } catch (err) {\n    // ignore\n  }",
    explanation: "Short explanation.",
    suggestion: "Short suggestion.",
    ...overrides,
  };
}

describe("formatReport", () => {
  it("shows location, rule, severity, confidence, numbered evidence, explanation, fix and summary", () => {
    const report = formatReport({ filesScanned: 1, findings: [makeFinding()], suppressed: [], warnings: [], skipped: [] });

    expect(report).toBe(
      [
        "src/a.ts:9:5",
        "  LP001 empty-catch | severity: high | confidence: medium",
        "  Evidence:",
        "     9 |   } catch (err) {",
        "    10 |     // ignore",
        "    11 |   }",
        "  Why: Short explanation.",
        "  Fix: Short suggestion.",
        "",
        "Scanned 1 file, 1 finding (LP001: 1)",
        "",
      ].join("\n"),
    );
  });

  it("prints only the summary when there are no findings", () => {
    expect(formatReport({ filesScanned: 4, findings: [], suppressed: [], warnings: [], skipped: [] })).toBe("Scanned 4 files, 0 findings\n");
  });

  it("counts findings per rule in the summary", () => {
    const findings = [makeFinding(), makeFinding({ line: 20 })];
    const report = formatReport({ filesScanned: 2, findings, suppressed: [], warnings: [], skipped: [] });

    expect(report.endsWith("Scanned 2 files, 2 findings (LP001: 2)\n")).toBe(true);
  });

  it("lists the per-rule counts in rule order, whichever rule was found first", () => {
    const findings = [makeFinding({ ruleId: "LP002" }), makeFinding(), makeFinding({ ruleId: "LP002" })];
    const report = formatReport({ filesScanned: 1, findings, suppressed: [], warnings: [], skipped: [] });

    expect(report.endsWith("Scanned 1 file, 3 findings (LP001: 1, LP002: 2)\n")).toBe(true);
  });

  it("word-wraps long text at 100 columns, indenting continuation lines", () => {
    const longText = "word ".repeat(60).trim(); // 299 characters
    const report = formatReport({ filesScanned: 1, findings: [makeFinding({ explanation: longText })], suppressed: [], warnings: [], skipped: [] });
    const whyLines = report.split("\n").filter((l) => l.startsWith("  Why:") || l.startsWith("       word"));

    expect(whyLines.length).toBeGreaterThan(1);
    for (const line of whyLines) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("formatReport: syntax errors (Milestone 2)", () => {
  it("counts the files with syntax errors in the summary", () => {
    const warning = (file: string) => ({ type: "syntax-error" as const, file, line: 1, message: `${file}: ...` });
    const report = formatReport({
      filesScanned: 3,
      findings: [],
      suppressed: [], warnings: [warning("a.js"), warning("b.js"), { type: "read-error", file: "c.js", message: "could not read c.js" }],
      skipped: [],
    });

    expect(report).toBe(
      "Scanned 3 files, 0 findings\n2 files had syntax errors; findings in them may be incomplete (see the warnings).\n",
    );
  });
});

describe("formatReport: what was not scanned (Milestone 2)", () => {
  const skipped: SkippedPath[] = [
    { path: ".git", kind: "folder", reason: "default-folder", detail: "git internals, never scanned" },
    { path: "node_modules", kind: "folder", reason: "default-folder", detail: "dependencies, never scanned" },
    { path: "public/app.min.js", kind: "file", reason: "minified-name", detail: "minified: the file name ends in .min.js" },
  ];

  it("adds a 'Not scanned' line with counts by reason and a hint", () => {
    const report = formatReport({ filesScanned: 4, findings: [], suppressed: [], warnings: [], skipped });

    expect(report).toBe(
      "Scanned 4 files, 0 findings\n" +
        "Not scanned: 1 file and 2 folders (default folders: 2, minified: 1). Run with --show-skipped to list them.\n",
    );
  });

  it("keeps the --show-skipped list readable for very long paths (no padded column)", () => {
    const longPath = `test/fixtures/${"deeply/".repeat(12)}node_modules`;
    const report = formatReport(
      { filesScanned: 0, findings: [], suppressed: [], warnings: [], skipped: [{ path: longPath, kind: "folder", reason: "default-folder", detail: "dependencies, never scanned" }] },
      { showSkipped: true },
    );

    expect(report).toContain(`\n  folder  ${longPath}  (dependencies, never scanned)\n`);
  });

  it("lists every skipped path with its reason when asked to (--show-skipped)", () => {
    const report = formatReport({ filesScanned: 4, findings: [], suppressed: [], warnings: [], skipped }, { showSkipped: true });

    expect(report).toBe(
      [
        "Scanned 4 files, 0 findings",
        "Not scanned: 1 file and 2 folders (default folders: 2, minified: 1).",
        "",
        "Not scanned (1 file, 2 folders):",
        "  folder  .git  (git internals, never scanned)",
        "  folder  node_modules  (dependencies, never scanned)",
        "  file    public/app.min.js  (minified: the file name ends in .min.js)",
        "",
      ].join("\n"),
    );
  });
});
