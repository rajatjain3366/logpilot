// Tests for src/suppressions.ts: logpilot-ignore comments, their required reason, and warnings.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { RULES } from "../src/scanner.js";
import { applySuppressions } from "../src/suppressions.js";

/** Runs the real rules on `lines`, then applies the suppression comments in them. */
function run(lines: string[], fileName = "a.ts") {
  const sourceFile = ts.createSourceFile(fileName, lines.join("\n"), ts.ScriptTarget.Latest, true);
  const findings = RULES.flatMap((rule) => rule.check(sourceFile, fileName));
  return applySuppressions(sourceFile, fileName, findings, ["LP001", "LP002"]);
}

describe("applySuppressions", () => {
  it("hides the finding on the next line, keeping the reason and the comment's line", () => {
    const result = run([
      "try { loadCache(); }",
      "// logpilot-ignore-next-line LP001 -- the cache is optional; a miss is normal",
      "catch {}",
    ]);

    expect(result.kept).toEqual([]);
    expect(result.suppressed.map((s) => [s.finding.ruleId, s.finding.line, s.reason, s.commentLine])).toEqual([
      ["LP001", 3, "the cache is optional; a miss is normal", 2],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("hides a finding on the same line with logpilot-ignore-line", () => {
    const result = run(["try { loadCache(); } catch {} // logpilot-ignore-line LP001 -- optional cache"]);

    expect(result.kept).toEqual([]);
    expect(result.suppressed).toHaveLength(1);
  });

  it("accepts block comments (also in JSX) and several rules in one comment", () => {
    const blockComment = run([
      "try { f(); } catch (err) {",
      '  /* logpilot-ignore-next-line LP002 -- clients must not see database details */',
      '  throw new Error("Internal error");',
      "}",
    ]);
    const jsx = run(
      [
        "function C() {",
        "  return <div>{/* logpilot-ignore-next-line LP001, LP002 -- demo only */}",
        "    {(() => { try { f(); } catch {} return null; })()}</div>;",
        "}",
      ],
      "a.tsx",
    );

    expect(blockComment.suppressed.map((s) => s.finding.ruleId)).toEqual(["LP002"]);
    expect(jsx.suppressed.map((s) => s.finding.ruleId)).toEqual(["LP001"]);
    // LP002 was named but had nothing to hide on that line: reported as unused.
    expect(jsx.warnings.map((w) => w.type)).toEqual(["unused-suppression"]);
  });

  it("does not apply a suppression without a reason, and says why", () => {
    const result = run(["try { f(); }", "// logpilot-ignore-next-line LP001", "catch {}"]);

    expect(result.kept).toHaveLength(1);
    expect(result.warnings).toEqual([
      {
        type: "invalid-suppression",
        file: "a.ts",
        line: 2,
        message: 'a.ts:2: this suppression has no reason; add "-- why" after the rule ID (it was not applied)',
      },
    ]);
  });

  it("does not apply a suppression without a rule ID (there is no 'ignore everything')", () => {
    const result = run(["try { f(); }", "// logpilot-ignore-next-line -- trust me", "catch {}"]);

    expect(result.kept).toHaveLength(1);
    expect(result.warnings[0].message).toBe(
      'a.ts:2: this suppression names no rule; write for example "logpilot-ignore-next-line LP001 -- why" (it was not applied)',
    );
  });

  it("warns about an unknown rule ID but still applies the known ones", () => {
    const result = run(["try { f(); }", "// logpilot-ignore-next-line LP009, LP001 -- optional step", "catch {}"]);

    expect(result.kept).toEqual([]);
    expect(result.warnings.map((w) => w.message)).toEqual([
      'a.ts:2: unknown rule "LP009" in a suppression (known rules: LP001, LP002)',
    ]);
  });

  it("warns about a suppression that matches no finding (for example after the code changed)", () => {
    const result = run(["// logpilot-ignore-next-line LP001 -- the catch below used to be empty", "doSomething();"]);

    expect(result.warnings).toEqual([
      {
        type: "unused-suppression",
        file: "a.ts",
        line: 1,
        message: "a.ts:1: the suppression for LP001 matched no finding on line 2; remove it if it is no longer needed",
      },
    ]);
  });

  it("only hides the very next line", () => {
    const result = run(["// logpilot-ignore-next-line LP001 -- too far away", "", "try { f(); } catch {}"]);

    expect(result.kept).toHaveLength(1);
    expect(result.warnings.map((w) => w.type)).toEqual(["unused-suppression"]);
  });

  it("ignores the directive inside strings and in comments that merely mention it", () => {
    const result = run([
      'const help = "// logpilot-ignore-next-line LP001 -- not a comment";',
      "// To silence a finding, see logpilot-ignore-next-line in the README.",
      "try { f(); } catch {}",
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.suppressed).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
