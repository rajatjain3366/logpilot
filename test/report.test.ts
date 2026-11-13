// Tests for the text report format.

import { describe, expect, it } from "vitest";
import { formatReport, reportWidth } from "../src/report.js";
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
    const report = formatReport({ filesScanned: 1, filesWithExpressHandlers: 1, findings: [makeFinding()], suppressed: [], warnings: [], skipped: [] });

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
    expect(formatReport({ filesScanned: 4, filesWithExpressHandlers: 4, findings: [], suppressed: [], warnings: [], skipped: [] })).toBe("Scanned 4 files, 0 findings\n");
  });

  it("counts findings per rule in the summary", () => {
    const findings = [makeFinding(), makeFinding({ line: 20 })];
    const report = formatReport({ filesScanned: 2, filesWithExpressHandlers: 2, findings, suppressed: [], warnings: [], skipped: [] });

    expect(report.endsWith("Scanned 2 files, 2 findings (LP001: 2)\n")).toBe(true);
  });

  it("lists the per-rule counts in rule order, whichever rule was found first", () => {
    const findings = [makeFinding({ ruleId: "LP002" }), makeFinding(), makeFinding({ ruleId: "LP002" })];
    const report = formatReport({ filesScanned: 1, filesWithExpressHandlers: 1, findings, suppressed: [], warnings: [], skipped: [] });

    expect(report.endsWith("Scanned 1 file, 3 findings (LP001: 1, LP002: 2)\n")).toBe(true);
  });

  it("word-wraps long text at 100 columns, indenting continuation lines", () => {
    const longText = "word ".repeat(60).trim(); // 299 characters
    const report = formatReport({ filesScanned: 1, filesWithExpressHandlers: 1, findings: [makeFinding({ explanation: longText })], suppressed: [], warnings: [], skipped: [] });
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
      filesWithExpressHandlers: 3,
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
    const report = formatReport({ filesScanned: 4, filesWithExpressHandlers: 4, findings: [], suppressed: [], warnings: [], skipped });

    expect(report).toBe(
      "Scanned 4 files, 0 findings\n" +
        "Not scanned: 1 file and 2 folders (default folders: 2, minified: 1). Run with --show-skipped to list them.\n",
    );
  });

  it("keeps the --show-skipped list readable for very long paths (no padded column)", () => {
    const longPath = `test/fixtures/${"deeply/".repeat(12)}node_modules`;
    const report = formatReport(
      { filesScanned: 0, filesWithExpressHandlers: 0, findings: [], suppressed: [], warnings: [], skipped: [{ path: longPath, kind: "folder", reason: "default-folder", detail: "dependencies, never scanned" }] },
      { showSkipped: true },
    );

    expect(report).toContain(`\n  folder  ${longPath}  (dependencies, never scanned)\n`);
  });

  it("lists every skipped path with its reason when asked to (--show-skipped)", () => {
    const report = formatReport({ filesScanned: 4, filesWithExpressHandlers: 4, findings: [], suppressed: [], warnings: [], skipped }, { showSkipped: true });

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

describe("formatReport: width (Milestone 3)", () => {
  it("wraps at 100 columns when not in a terminal or when writing a file, and at the terminal's width otherwise", () => {
    expect(reportWidth({ isTTY: false, columns: 80 }, false)).toBe(100); // piped
    expect(reportWidth({ isTTY: true, columns: 80 }, true)).toBe(100); //   --output file
    expect(reportWidth({}, false)).toBe(100);
    expect(reportWidth({ isTTY: true, columns: 80 }, false)).toBe(79); //   one less than the terminal
    expect(reportWidth({ isTTY: true, columns: 40 }, false)).toBe(60); //   never narrower than 60
    expect(reportWidth({ isTTY: true, columns: 200 }, false)).toBe(100); // never wider than 100
  });

  it("wraps text at the given width, but never wraps evidence or diff lines (they are code)", () => {
    const longCode = `    res.status(500).json({ message: "${"x".repeat(90)}" });`;
    const diff = `--- a/src/a.ts\n+++ b/src/a.ts\n@@ -9,1 +9,2 @@\n+${longCode}\n ${longCode}\n`;
    const finding = makeFinding({
      evidence: longCode,
      explanation: "word ".repeat(40).trim(),
      ruleId: "LP003",
      fix: { status: "available", description: "Log it.", notes: [], edits: [], diff },
    });
    const report = formatReport({ filesScanned: 1, filesWithExpressHandlers: 1, findings: [finding], suppressed: [], warnings: [], skipped: [] }, { width: 60, fixPreview: true });
    const lines = report.split("\n");

    for (const line of lines.filter((l) => l.includes("word"))) expect(line.length).toBeLessThanOrEqual(60);
    expect(lines).toContain(`    9 | ${longCode}`); // one evidence line: a 1-digit gutter
    expect(lines).toContain(`    +${longCode}`);
    expect(lines).toContain(`     ${longCode}`);
  });
});

describe("formatReport: concise output by default, full text with --verbose (Milestone 3)", () => {
  const explanation = "This catch sends an error (status 500). You will not see why. Loggers do not help."; // fits on one line
  const suggestion = "Log the error, e.g. console.error(err). Never log tokens.";
  const findings = [
    makeFinding({ ruleId: "LP003", line: 10, explanation, suggestion }),
    // Same kind: another status and another variable name, so only the first sentence differs.
    makeFinding({ ruleId: "LP003", line: 20, explanation: explanation.replace("500", "503"), suggestion: suggestion.replace("(err)", "(error)") }),
    // Same kind, with one extra sentence in the suggestion.
    makeFinding({ ruleId: "LP003", line: 30, explanation, suggestion: `${suggestion} Write \`catch (err)\` first.` }),
    // Another file: the reference names the file.
    makeFinding({ ruleId: "LP003", file: "src/b.ts", line: 5, explanation, suggestion }),
    // Another kind (different second sentence): full text again.
    makeFinding({ ruleId: "LP003", line: 40, explanation: "This catch sends the error to the client. Your logs keep nothing.", suggestion }),
  ];
  const result = { filesScanned: 2, filesWithExpressHandlers: 2, findings, suppressed: [], warnings: [], skipped: [] };
  const whyAndFix = (report: string) => report.split("\n").filter((l) => /^ {2}(Why|Fix|Why and fix):/.test(l));

  it("prints the full text the first time a rule and case appear, then one line that points back to it", () => {
    expect(whyAndFix(formatReport(result))).toEqual([
      `  Why: ${explanation}`,
      `  Fix: ${suggestion}`,
      "  Why and fix: same as for line 10 above.",
      "  Why: same as for line 10 above.",
      "  Fix: Write `catch (err)` first. (The rest: same as for line 10 above.)",
      "  Why and fix: same as for src/a.ts:10 above.",
      "  Why: This catch sends the error to the client. Your logs keep nothing.",
      `  Fix: ${suggestion}`,
    ]);
  });

  it("repeats the full text for every finding with --verbose", () => {
    const lines = whyAndFix(formatReport(result, { verbose: true }));
    expect(lines).toHaveLength(10);
    expect(lines.filter((l) => l.includes("same as"))).toEqual([]);
  });

  it("shows a repeated fix note, no-fix reason and logger once, then refers back; the diff is always shown", () => {
    const fix = (line: number) =>
      makeFinding({
        ruleId: "LP003",
        line,
        fix: {
          status: "available",
          description: `Log it before line ${line}.`,
          logger: { kind: "console", call: "console.error", confidence: "low", evidence: "no logger" },
          notes: ["The response is unchanged."],
          edits: [],
          diff: `--- a/src/a.ts\n+++ b/src/a.ts\n@@ -${line},1 +${line},2 @@\n+console.error(err);\n x\n`,
        },
      });
    const noFix = (line: number) => makeFinding({ ruleId: "LP003", line, fix: { status: "not-available", reason: "No fix for a 4xx answer.", notes: [], edits: [] } });
    const report = formatReport({ filesScanned: 1, filesWithExpressHandlers: 1, findings: [fix(10), fix(20), noFix(30), noFix(40)], suppressed: [], warnings: [], skipped: [] }, { fixPreview: true });

    expect(report).toContain("    Logger: console.error (confidence low: no logger)");
    expect(report).toContain("    Logger: same as for line 10 above.");
    expect(report).toContain("  Note: The response is unchanged.");
    expect(report).toContain("  Note: same as for line 10 above.");
    expect(report).toContain("  Checked: same as for line 10 above.");
    expect(report).toContain("    @@ -20,1 +20,2 @@");
    expect(report).toContain("  No fix proposed: No fix for a 4xx answer.");
    expect(report).toContain("  No fix proposed: same as for line 30 above.");
  });
});

// v0.4.3: findings with the same pattern are listed under the first one.
describe("formatReport: repeated patterns (v0.4.3)", () => {
  const ApiError = { id: "LP002-aaaaaaaa", label: "throw new ApiError(...) without the caught error" };
  const TextOnly = { id: "LP002-bbbbbbbb", label: "throw new Error(...) that keeps only the caught error's text" };
  const lp002 = (file: string, line: number, pattern = ApiError) =>
    makeFinding({ ruleId: "LP002", ruleName: "lost-error-cause", file, line, evidence: `    throw new X("${file}:${line}");`, pattern });
  const result = (findings: Finding[]) => ({ filesScanned: 3, filesWithExpressHandlers: 0, findings, suppressed: [], warnings: [], skipped: [] });

  it("shows the first finding of a pattern in full and lists every other location under it", () => {
    const findings = [lp002("a.ts", 3), lp002("a.ts", 9, TextOnly), lp002("b.ts", 4), lp002("c.ts", 7)];
    const report = formatReport(result(findings), { width: 100 });

    expect(report).toBe(
      [
        "a.ts:3:5",
        "  LP002 lost-error-cause | severity: high | confidence: medium",
        "  Evidence:",
        '    3 |     throw new X("a.ts:3");',
        "  Why: Short explanation.",
        "  Fix: Short suggestion.",
        "  Same pattern in 2 more places (throw new ApiError(...) without the caught error):",
        "    b.ts:4:5",
        "    c.ts:7:5",
        "",
        "a.ts:9:5",
        "  LP002 lost-error-cause | severity: high | confidence: medium",
        "  Evidence:",
        '    9 |     throw new X("a.ts:9");',
        "  Why and fix: same as for line 3 above.",
        "",
        "Scanned 3 files, 4 findings in 2 patterns (LP002: 4)",
        "No Express handlers found: LP003 and fix previews only check Express apps.",
        "",
      ].join("\n"),
    );
  });

  it("says '1 more place' for a pair, and does not group a pattern that occurs once", () => {
    const report = formatReport(result([lp002("a.ts", 3), lp002("b.ts", 4), lp002("c.ts", 5, TextOnly)]));

    expect(report).toContain("  Same pattern in 1 more place (throw new ApiError(...) without the caught error):\n    b.ts:4:5\n");
    expect(report.match(/Same pattern/g)).toHaveLength(1);
    expect(report).toContain("\nc.ts:5:5\n");
  });

  it("shows every finding in full with --verbose, and still counts patterns", () => {
    const report = formatReport(result([lp002("a.ts", 3), lp002("b.ts", 4)]), { verbose: true });

    expect(report).not.toContain("Same pattern");
    expect(report).toContain("\nb.ts:4:5\n");
    expect(report).toContain('    4 |     throw new X("b.ts:4");');
    expect(report).toContain("Scanned 3 files, 2 findings in 1 pattern (LP002: 2)");
  });

  it("never groups findings without a pattern (LP003), and leaves out 'in N patterns' when nothing repeats", () => {
    const lp003 = (line: number) => makeFinding({ ruleId: "LP003", ruleName: "unlogged-error-response", line });
    const report = formatReport(result([lp003(3), lp003(9)]));

    expect(report).not.toContain("Same pattern");
    expect(report).toContain("\nsrc/a.ts:9:5\n");
    expect(report).toContain("Scanned 3 files, 2 findings (LP003: 2)");
  });
});

describe("formatReport: rules that are off by default (v0.4.3)", () => {
  const off = [{ id: "LP001", name: "empty-catch", reason: "most empty catches are deliberate" }];
  const line =
    'LP001 (empty-catch) is off by default: most empty catches are deliberate. Turn it on with "rules": { "LP001": "on" } ' +
    "in logpilot.config.json, or --enable LP001.";

  it("says once in the summary that a rule is off by default, and how to turn it on", () => {
    const report = formatReport({ filesScanned: 2, filesWithExpressHandlers: 2, findings: [], suppressed: [], warnings: [], skipped: [] }, { offByDefault: off });

    expect(report).toBe(`Scanned 2 files, 0 findings\n${line}\n`);
  });

  it("says nothing when no rule is off by default, or when nothing was scanned", () => {
    expect(formatReport({ filesScanned: 2, filesWithExpressHandlers: 2, findings: [], suppressed: [], warnings: [], skipped: [] })).toBe("Scanned 2 files, 0 findings\n");
    expect(formatReport({ filesScanned: 0, filesWithExpressHandlers: 0, findings: [], suppressed: [], warnings: [], skipped: [] }, { offByDefault: off })).toBe(
      "Scanned 0 files, 0 findings\n",
    );
  });
});
