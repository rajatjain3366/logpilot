// Unit tests for rule LP001 (empty-catch).
// Positive fixtures contain code the rule MUST report; negative fixtures contain
// correct error handling the rule must NOT report.

import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkEmptyCatch } from "../src/rules/lp001-empty-catch.js";

/** Parses source text into a syntax tree and runs LP001 on it. */
function runOnCode(fileName: string, code: string) {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  return checkEmptyCatch(sourceFile, fileName);
}

/** Reads a fixture (path relative to test/fixtures/) and runs LP001 on it. */
function runOnFixture(relativePath: string) {
  const code = readFileSync(new URL(`./fixtures/${relativePath}`, import.meta.url), "utf8");
  return runOnCode(relativePath, code);
}

describe("LP001 empty-catch: positive fixtures (must report)", () => {
  // Changed on purpose in precision round 2: without positive evidence that the swallowed error
  // matters, an empty catch is "worth reviewing" (severity medium), no longer high.
  it("reports completely empty catch blocks at the default severity medium, confidence high", () => {
    const findings = runOnFixture("positive/empty-catch.ts");

    expect(findings.map((f) => [f.line, f.column, f.confidence])).toEqual([
      [9, 5, "high"], //  } catch (err) {}
      [16, 5, "high"], // } catch {}
      [22, 5, "high"], // } catch (error) {  (empty, spread over two lines)
    ]);
    for (const finding of findings) {
      expect(finding.ruleId).toBe("LP001");
      expect(finding.ruleName).toBe("empty-catch");
      expect(finding.severity).toBe("medium");
      expect(finding.file).toBe("positive/empty-catch.ts");
      expect(finding.explanation).toContain("empty");
      expect(finding.explanation).toContain("review it"); // medium reads as "review this", not "this is a bug"
    }
  });

  it("uses the catch's real variable name in the suggestion", () => {
    const [withErr, withoutVariable, withError] = runOnFixture("positive/empty-catch.ts");
    const [withParseError] = runOnFixture("positive/empty-catch-in-component.tsx");

    // catch (err) {}
    expect(withErr.suggestion).toContain('logger.error({ err }, "failed to load config")');
    expect(withErr.suggestion).toContain("{ cause: err })");
    // catch {}  -> examples fall back to `err`
    expect(withoutVariable.suggestion).toContain("{ cause: err })");
    // catch (error) {}  -> pino needs the key "err", so { err: error }
    expect(withError.suggestion).toContain('logger.error({ err: error }, "failed to load config")');
    expect(withError.suggestion).toContain("{ cause: error })");
    expect(withError.suggestion).not.toContain("{ cause: err })");
    // catch (parseError) {}
    expect(withParseError.suggestion).toContain('logger.error({ err: parseError }, "failed to load config")');
    expect(withParseError.suggestion).toContain("{ cause: parseError })");
  });

  it("copies the catch clause's source lines as evidence", () => {
    const findings = runOnFixture("positive/empty-catch.ts");

    expect(findings[0].evidence).toBe("  } catch (err) {}");
    expect(findings[2].evidence).toBe("  } catch (error) {\n  }");
  });

  it("tells the user to add an error variable only when the catch has none", () => {
    const findings = runOnFixture("positive/empty-catch.ts");

    expect(findings[0].suggestion).not.toContain("write `catch (err)`"); // catch (err) {}
    expect(findings[1].suggestion).toContain("write `catch (err)`"); //     catch {}
  });

  // CHANGED ON PURPOSE (Milestone 2.5): a comment no longer lowers severity (it was "low" since the
  // LP001 tuning). Round 2 found real bugs next to comments, so a comment now lowers only confidence.
  it("reports comment-only catch blocks with the default severity medium and confidence medium (rule 1)", () => {
    const findings = runOnFixture("positive/comment-only-catch.js");

    expect(findings.map((f) => [f.line, f.column, f.severity, f.confidence])).toEqual([
      [7, 5, "medium", "medium"], //  // ignore: the cache is optional
      [16, 5, "medium", "medium"], // /* already closed */
    ]);
    expect(findings[0].explanation).toContain("only a comment");
    expect(findings[0].evidence).toBe("  } catch (err) {\n    // ignore: the cache is optional\n  }");
  });

  it("parses JSX in a .tsx file and reports the empty catch inside the component", () => {
    const findings = runOnFixture("positive/empty-catch-in-component.tsx");

    expect(findings.map((f) => [f.line, f.column, f.confidence])).toEqual([[10, 5, "high"]]);
  });
});

describe("LP001 empty-catch: negative fixtures (must NOT report)", () => {
  it.each([
    "negative/logs-error.js", //      console.error(...) + "catch (e) {}" inside a string and a comment
    "negative/uses-logger.ts", //     logger.error(...) pino-style and winston-style
    "negative/rethrows.ts", //        throw err / throw new Error(..., { cause }) / nested try
    "negative/returns-fallback.ts", // return [] / return null
    "negative/lp001-test-assertion-handled.spec.ts", // rejects.toThrow() / catch that checks the error
    "negative/lp001-handled-near-comments.ts", //      comment above try + nested catch that logs
    "negative/lp001-guarded-handled.ts", //            existence check + catch that logs
    "negative/lp003-handled.js", //                    Express catches that keep the error (Milestone 2.5)
  ])("%s has no findings", (fixture) => {
    expect(runOnFixture(fixture)).toEqual([]);
  });
});

/** [line, column, severity, confidence] for each finding: compact and easy to compare. */
function positions(findings: ReturnType<typeof runOnCode>) {
  return findings.map((f) => [f.line, f.column, f.severity, f.confidence]);
}

describe("LP001 tuning, rule 1: a comment explains the ignore (confidence medium)", () => {
  // CHANGED ON PURPOSE (Milestone 2.5): severity stays at the default medium (it was "low");
  // the comment lowers only the confidence.
  it("counts a comment inside the try, at the end of a try line, directly above the try, or after the catch", () => {
    const findings = runOnFixture("edge/lp001-explained-ignore.ts");

    expect(positions(findings)).toEqual([
      [15, 5, "medium", "medium"], // own-line comment inside the try
      [23, 5, "medium", "medium"], // comment at the end of a line inside the try
      [33, 5, "medium", "medium"], // two comment lines directly above the try
      [40, 5, "medium", "medium"], // } catch {} // comment
    ]);
    for (const finding of findings) {
      expect(finding.explanation).toContain("a comment next to it");
    }
  });

  // Severity changed on purpose in precision round 2 (default high -> medium); confidence unchanged.
  it("does not count annotations inside code, or comments separated from the try (medium / high)", () => {
    const findings = runOnFixture("positive/lp001-unexplained-comments.ts");

    expect(positions(findings)).toEqual([
      [11, 5, "medium", "high"], // /* #__KEEP__ */ inside a call
      [21, 5, "medium", "high"], // comment above the previous line of code
      [31, 5, "medium", "high"], // comment followed by a blank line
      [40, 5, "medium", "high"], // comment at the end of the previous code line
    ]);
    for (const finding of findings) {
      expect(finding.explanation).toContain("This catch block is empty.");
    }
  });
});

describe("LP001 tuning, rule 2: inside another catch whose error is still passed on (low)", () => {
  it("lowers severity when the outer error is rethrown or handed on", () => {
    const findings = runOnFixture("edge/lp001-inside-error-handling.ts");

    expect(positions(findings)).toEqual([
      [23, 7, "low", "high"], // outer catch (e) ends with `throw e`
      [35, 7, "low", "high"], // outer catch (err) calls reportFailure(err)
    ]);
    expect(findings[0].explanation).toContain("another error (`e`, caught on line 19)");
    expect(findings[1].explanation).toContain("another error (`err`, caught on line 32)");
    expect(findings[0].suggestion).toContain("Usually no change is needed, as long as `e` keeps being passed on");
    expect(findings[0].suggestion).toContain("write `catch (err)`");
  });

  // Severity changed on purpose in precision round 2 (default high -> medium): the point of this
  // test is that rule 2 does NOT lower these to "low".
  it("keeps the default severity when the outer error is not passed on or the inner code runs later", () => {
    const findings = runOnFixture("positive/lp001-inside-error-handling-lost.ts");

    expect(positions(findings)).toEqual([
      [16, 7, "medium", "high"], // outer error only inspected and turned into text
      [29, 7, "medium", "high"], // outer catch has no variable
      [41, 9, "medium", "high"], // inner try is inside a setTimeout callback
    ]);
  });

  it("combines with rule 1: a comment and an outer error that is passed on give low / medium", () => {
    const code = ["try { a(); } catch (e) {", "  try { b(); } catch {} // best effort", "  throw e;", "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[2, 16, "low", "medium"]]);
  });
});

describe("LP001 tuning, rule 3: the try contains a test-failure assertion (always high / high)", () => {
  it("keeps high / high even with a comment, and explains that the test cannot fail", () => {
    const findings = runOnFixture("positive/lp001-test-assertion.spec.ts");

    expect(positions(findings)).toEqual([
      [16, 5, "high", "high"], // expect.unreachable()
      [23, 5, "high", "high"], // expect.fail() + comment inside the catch
      [32, 5, "high", "high"], // assert.fail() + comment after the catch
      // CHANGED ON PURPOSE (Milestone 2.5): was "low"; the comment above the try lowers only confidence.
      [41, 5, "medium", "medium"], // assertion inside a callback: not rule 3, so rule 1 applies
    ]);
    expect(findings[0].explanation).toContain("calls expect.unreachable(), which fails the test");
    expect(findings[1].explanation).toContain("calls expect.fail()");
    expect(findings[2].explanation).toContain("calls assert.fail()");
    expect(findings[0].suggestion).toContain("rejects.toThrow");
  });

  it("wins over rule 2 as well", () => {
    const code = ["try { a(); } catch (e) {", "  try { expect.unreachable(); } catch {}", "  throw e;", "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[2, 33, "high", "high"]]);
  });
});

describe("LP001 precision round 2: high severity needs positive evidence (an existence check)", () => {
  it("reports high / high when an existence check on the same thing runs before the risky code", () => {
    const findings = runOnFixture("positive/lp001-guarded-swallow.ts");

    expect(positions(findings)).toEqual([
      [17, 7, "high", "high"], // if (existsSync(file)) { try {...} }
      [28, 5, "high", "high"], // try { if (existsSync(file)) {...} }
      [38, 5, "high", "high"], // if (!cache.has(key)) return;  try {...}
      [47, 5, "high", "high"], // try { if (!existsSync(dir)) return; ... }
      [56, 7, "high", "high"], // if (key in options) { try {...} }
      [67, 7, "high", "high"], // if (statSync(dir).isDirectory()) { try {...} }
    ]);
    const checkLines = [14, 25, 34, 45, 53, 64];
    findings.forEach((finding, i) => {
      expect(finding.explanation).toContain(`the check on line ${checkLines[i]} already rules out the expected failure`);
    });
  });

  it("keeps the default medium when the check is about something else, negated, in the else branch, or not a check", () => {
    const findings = runOnFixture("edge/lp001-guard-not-applicable.ts");

    expect(positions(findings)).toEqual([
      [13, 7, "medium", "high"], // the check is about a different file
      [23, 7, "medium", "high"], // if (!existsSync(dir)) { try { mkdirSync(dir) } }
      [34, 7, "medium", "high"], // the try is in the else branch
      [44, 7, "medium", "high"], // if (enabled): a plain flag
      [54, 7, "medium", "high"], // existsSync(file) === false
      [64, 5, "medium", "high"], // if (!existsSync(file)) warn(...): not an exit
    ]);
  });

  // CHANGED ON PURPOSE (Milestone 2.5): a comment no longer wins over the existence check. The check
  // still makes it high; the comment lowers only confidence (was low / medium). The outer error that
  // is passed on still wins (low).
  it("keeps high with a comment (confidence medium), but lets an outer error that is passed on win (low)", () => {
    const commented = ["if (existsSync(f)) {", "  // the file may be half-written; ignore", "  try { read(f); } catch {}", "}"];
    const nested = ["try { a(); } catch (e) {", "  if (existsSync(f)) { try { read(f); } catch {} }", "  throw e;", "}"];

    expect(positions(runOnCode("a.ts", commented.join("\n")))).toEqual([[3, 20, "high", "medium"]]);
    expect(positions(runOnCode("b.ts", nested.join("\n")))).toEqual([[2, 41, "low", "high"]]);
  });
});

describe("LP001 Milestone 2.5: a comment lowers confidence, never severity", () => {
  it("keeps the severity the evidence gives, and lowers confidence to medium", () => {
    const plain = "try { a(); } catch {} // optional step";
    const guarded = ["if (existsSync(f)) {", "  // the file may be half-written; ignore", "  try { read(f); } catch {}", "}"];
    const nested = ["try { a(); } catch (e) {", "  try { b(); } catch {} // best effort", "  throw e;", "}"];
    const assertion = "try { a(); expect.fail(); } catch {} // expected";

    expect(positions(runOnCode("a.ts", plain))).toEqual([[1, 14, "medium", "medium"]]); //       default
    expect(positions(runOnCode("b.ts", guarded.join("\n")))).toEqual([[3, 20, "high", "medium"]]); // existence check
    expect(positions(runOnCode("c.ts", nested.join("\n")))).toEqual([[2, 16, "low", "medium"]]); //  outer error passed on
    expect(positions(runOnCode("d.ts", assertion))).toEqual([[1, 29, "high", "high"]]); //            swallowed assertion
  });

  it("explains that a comment shows intent, not that every failure is harmless", () => {
    const [plain] = runOnCode("a.ts", "try { a(); } catch {} // optional step");
    const [guarded] = runOnCode("b.ts", ["if (existsSync(f)) {", "  // ignore", "  try { read(f); } catch {}", "}"].join("\n"));

    expect(plain.explanation).toContain("A comment shows that the ignore is intended, not that every possible failure here is harmless");
    expect(guarded.explanation).toContain("the check on line 1 already rules out the expected failure");
    expect(guarded.explanation).toContain("A comment next to it suggests the ignore is deliberate");
  });
});

describe("LP001 Milestone 2.5: tool directives are not explanations", () => {
  it("reports catches next to ESLint, TypeScript, coverage, Prettier and Biome directives like uncommented ones", () => {
    const findings = runOnFixture("positive/lp001-tool-directives.ts");

    expect(positions(findings)).toEqual([
      [15, 5, "medium", "high"], //  /* eslint-disable no-empty */ above the try
      [22, 5, "medium", "high"], //  // eslint-disable-line no-empty -- with a description
      [30, 5, "medium", "high"], //  // eslint-disable-next-line inside the try
      [39, 5, "medium", "high"], //  // @ts-ignore
      [47, 5, "medium", "high"], //  // @ts-expect-error with a description
      [55, 5, "medium", "high"], //  /* istanbul ignore next */ inside the catch
      [64, 5, "medium", "high"], //  /* c8 ignore next 3 */ above the try
      [70, 5, "medium", "high"], //  /* v8 ignore next */ after the catch
      [76, 26, "medium", "high"], // // prettier-ignore above the try
      [82, 5, "medium", "high"], //  // biome-ignore inside the catch
    ]);
    for (const finding of findings) {
      expect(finding.explanation).toContain("This catch block is empty.");
    }
  });

  it("does not count a logpilot-ignore comment as an explanation", () => {
    const code = "try { a(); } catch {} // logpilot-ignore-line LP001 -- the cache is optional";

    expect(positions(runOnCode("a.ts", code))).toEqual([[1, 14, "medium", "high"]]);
  });

  it("still counts a real comment next to a directive", () => {
    const above = ["// the cache is optional", "// eslint-disable-next-line no-empty", "try { a(); } catch {}"];
    const inCatch = "try { a(); } catch { /* istanbul ignore next */ /* closing twice is fine */ }";

    expect(positions(runOnCode("a.ts", above.join("\n")))).toEqual([[3, 14, "medium", "medium"]]);
    expect(positions(runOnCode("b.ts", inCatch))).toEqual([[1, 14, "medium", "medium"]]);
  });

  it("treats a comment as a directive only when it starts with one", () => {
    const code = "try { a(); } catch {} // safe to ignore; this is why eslint-disable is not needed";

    expect(positions(runOnCode("a.ts", code))).toEqual([[1, 14, "medium", "medium"]]);
  });
});

describe("LP001 Milestone 2.5: more swallowed test assertions (high / high)", () => {
  it("recognises assert(false), assert.ok(false), chai's expect.fail()/assert.fail(), test.ok(false), test.fail()", () => {
    const findings = runOnFixture("positive/lp001-test-assertion-more.spec.ts");

    expect(positions(findings)).toEqual([
      [17, 7, "high", "high"],
      [24, 7, "high", "high"],
      [31, 7, "high", "high"],
      [38, 7, "high", "high"],
      [45, 7, "high", "high"],
      [52, 7, "high", "high"],
    ]);
    expect(findings.map((f) => f.explanation.match(/calls (\S+), which fails the test/)?.[1])).toEqual([
      "assert(false)",
      "assert.ok(false)",
      "chai.expect.fail()",
      "chai.assert.fail()",
      "test.ok(false)",
      "test.fail()",
    ]);
  });

  it("does not treat tap/tape/AVA test-context assertions (t is a parameter) as swallowed", () => {
    const findings = runOnFixture("edge/lp001-test-context-assertions.spec.js");

    expect(positions(findings)).toEqual([
      [14, 5, "medium", "high"], // t.fail() inside (t) => { ... }
      [22, 5, "medium", "high"], // t.ok(false) inside (t) => { ... }
      [30, 5, "medium", "high"], // assert(value): not the literal false
    ]);
    for (const finding of findings) {
      expect(finding.explanation).not.toContain("can never fail");
    }
  });

  it("needs the literal false for assert() and ok(): a checked value is a normal assertion", () => {
    expect(positions(runOnCode("a.ts", "try { a(); assert(result); } catch {}"))).toEqual([[1, 30, "medium", "high"]]);
    expect(positions(runOnCode("b.ts", "try { a(); assert.ok(false); } catch {}"))).toEqual([[1, 32, "high", "high"]]);
  });
});

describe("LP001 empty-catch: edge cases", () => {
  it("treats a catch block holding only a stray semicolon as empty", () => {
    expect(runOnCode("a.ts", "try { f(); } catch (e) { ; }")).toHaveLength(1);
  });

  it("treats a destructured catch binding like a missing variable in the suggestion", () => {
    const findings = runOnCode("a.ts", "try { f(); } catch ({ message }) {}");

    expect(findings).toHaveLength(1);
    expect(findings[0].suggestion).toContain("{ cause: err })");
    expect(findings[0].suggestion).toContain("write `catch (err)`");
  });

  it("does not report a try/finally that has no catch", () => {
    expect(runOnCode("a.ts", "try { f(); } finally { g(); }")).toEqual([]);
  });

  it("limits evidence to 5 lines", () => {
    const code = ["try {", "  f();", "} catch (e) {", "  // 1", "  // 2", "  // 3", "  // 4", "  // 5", "}"].join("\n");
    const findings = runOnCode("a.js", code);

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].evidence.split("\n")).toHaveLength(5);
  });

  it("reports correct lines for files with Windows (CRLF) line endings", () => {
    const findings = runOnCode("a.ts", "try {\r\n  f();\r\n} catch (e) {}\r\n");

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].evidence).toBe("} catch (e) {}");
  });
});
