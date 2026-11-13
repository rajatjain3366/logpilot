// Unit tests for rule LP002 (lost-error-cause).
// positive/ fixtures: code the rule MUST report. edge/ fixtures: tricky code the rule must
// report, often at reduced severity or confidence. negative/ fixtures: code NO rule may report.

import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkLostErrorCause } from "../src/rules/lp002-lost-error-cause.js";
import type { Finding } from "../src/types.js";

/** Parses source text into a syntax tree and runs LP002 on it. */
function runOnCode(fileName: string, code: string) {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  return checkLostErrorCause(sourceFile, fileName);
}

/** Reads a fixture (path relative to test/fixtures/) and runs LP002 on it. */
function runOnFixture(relativePath: string) {
  const code = readFileSync(new URL(`./fixtures/${relativePath}`, import.meta.url), "utf8");
  return runOnCode(relativePath, code);
}

/** [line, column, severity, confidence] for each finding: compact and easy to compare. */
function positions(findings: Finding[]) {
  return findings.map((f) => [f.line, f.column, f.severity, f.confidence]);
}

describe("LP002 lost-error-cause: positive fixtures (must report)", () => {
  it("P1: reports a new error that drops the caught one (high / high)", () => {
    const findings = runOnFixture("positive/lp002-lost-cause.ts");

    expect(positions(findings)).toEqual([
      [14, 5, "high", "high"], // throw new Error("Failed to load config")
      [23, 5, "high", "high"], // throw new DatabaseError(`Could not load user ${id}`)
      [32, 5, "high", "high"], // throw Error("Invalid port")   (no `new`)
      [41, 5, "high", "high"], // throw new Error;               (no arguments at all)
    ]);
    for (const finding of findings) {
      expect(finding.ruleId).toBe("LP002");
      expect(finding.ruleName).toBe("lost-error-cause");
      expect(finding.file).toBe("positive/lp002-lost-cause.ts");
      expect(finding.explanation).toContain("without attaching it");
    }
    expect(findings[0].evidence).toBe('    throw new Error("Failed to load config");');
    expect(findings[0].explanation).toContain("`err` (caught on line 13)");
    expect(findings[1].explanation).toContain("`error` (caught on line 22)");
  });

  it("P1: the suggestion reuses the real variable name, class and message", () => {
    const [loadConfig, findUser, parsePort, connect] = runOnFixture("positive/lp002-lost-cause.ts");

    expect(loadConfig.suggestion).toContain('throw new Error("Failed to load config", { cause: err })');
    expect(findUser.suggestion).toContain("throw new DatabaseError(`Could not load user ${id}`, { cause: error })");
    expect(parsePort.suggestion).toContain('throw new Error("Invalid port", { cause: e })');
    expect(connect.suggestion).toContain('throw new Error("...", { cause: err })');
    // Only our own classes may need a constructor change; the built-in Error accepts { cause }.
    expect(findUser.suggestion).toContain("If DatabaseError does not accept an options argument yet");
    expect(loadConfig.suggestion).not.toContain("does not accept an options argument");
  });

  it("P2: reports a new error that keeps only the caught error's text (medium / high)", () => {
    const findings = runOnFixture("positive/lp002-message-only.js");

    expect(positions(findings)).toEqual([
      [10, 5, "medium", "high"], // `...${err.message}`
      [18, 5, "medium", "high"], // "Connection failed: " + err
      [26, 5, "medium", "high"], // new UploadError(String(err))
      [35, 5, "medium", "high"], // new Error(err)
      [43, 5, "medium", "high"], // `...${error.code}...`
    ]);
    for (const finding of findings) {
      expect(finding.explanation).toContain("keeps only part of it");
    }
    expect(findings[0].suggestion).toContain(
      "throw new Error(`Failed to read settings: ${err.message}`, { cause: err })",
    );
    // new Error(err): the example does not repeat err as the message.
    expect(findings[3].suggestion).toContain('throw new Error("...", { cause: err })');
  });

  it("P3: reports the caught error passed as Error's options argument (high / high)", () => {
    const findings = runOnFixture("positive/lp002-options-mistake.ts");

    expect(positions(findings)).toEqual([
      [11, 5, "high", "high"], // new Error("Failed to fetch profile", err)
      [19, 5, "high", "high"], // new TypeError("Expected a number", parseError as Error)
    ]);
    expect(findings[0].explanation).toContain("`err` (caught on line 10) as the second argument of `Error`");
    expect(findings[1].explanation).toContain("as the second argument of `TypeError`");
    expect(findings[0].suggestion).toContain('throw new Error("Failed to fetch profile", { cause: err })');
    expect(findings[1].suggestion).toContain('throw new TypeError("Expected a number", { cause: parseError })');
  });

  // Severity changed on purpose in precision round 2: without a usable variable the new error is
  // often a deliberate translation, so A3 is "worth reviewing" (medium), no longer high.
  it("A3: reports catches without a usable error variable as worth reviewing (medium / medium)", () => {
    const findings = runOnFixture("positive/lp002-no-binding.ts");

    expect(positions(findings)).toEqual([
      [11, 5, "medium", "medium"], // catch {}
      [19, 5, "medium", "medium"], // catch ({ message })
      [27, 5, "medium", "medium"], // catch (_err)
    ]);
    for (const finding of findings) {
      expect(finding.explanation).toContain("often a deliberate translation into a clearer error, so review it");
    }
    expect(findings[0].explanation).toContain("does not keep the whole caught error in a variable");
    expect(findings[1].explanation).toContain("does not keep the whole caught error in a variable");
    expect(findings[0].suggestion).toContain("{ cause: err })");
    expect(findings[0].suggestion).toContain("Write `catch (err)`");
    expect(findings[1].suggestion).toContain("Write `catch (err)`");
    expect(findings[2].explanation).toContain("leading underscore in `_err`");
    expect(findings[2].suggestion).toContain('throw new Error("Optional file is missing", { cause: _err })');
    expect(findings[2].suggestion).not.toContain("Write `catch (err)`");
  });
});

describe("LP002 lost-error-cause: edge fixtures (reported, often at reduced severity or confidence)", () => {
  it("A1: logged first, then thrown without the cause (low / medium)", () => {
    const findings = runOnFixture("edge/lp002-logged-then-thrown.ts");

    expect(positions(findings)).toEqual([
      [17, 5, "low", "medium"], // after logger.error({ err }, ...)
      [26, 5, "low", "medium"], // after console.error("...", error)
    ]);
    expect(findings[0].explanation).toContain("`err` is logged above");
    expect(findings[1].explanation).toContain("`error` is logged above");
    expect(findings[0].suggestion).toContain("drop the separate log call");
  });

  it("A4: replaced after checking which error it is (low / medium); `throw err` is not reported", () => {
    const findings = runOnFixture("edge/lp002-guarded-translation.ts");

    expect(positions(findings)).toEqual([
      [17, 7, "low", "medium"], //  if (err.code === "ENOENT") { throw new NotFoundError(...) }
      [27, 46, "low", "medium"], // if (err instanceof ...) throw new ConflictError(...)
      [38, 9, "low", "medium"], //  switch (err.code) { case "E_EMPTY": throw new Error(...) }
    ]);
    for (const finding of findings) {
      expect(finding.explanation).toContain("The surrounding condition checks `err`");
    }
  });

  it("A2: a comment in the catch block lowers confidence, not severity (high / medium)", () => {
    const findings = runOnFixture("edge/lp002-commented-boundary.ts");

    expect(positions(findings)).toEqual([[18, 5, "high", "medium"]]);
    expect(findings[0].explanation).toContain("A comment in this catch block may explain a deliberate choice");
    expect(findings[0].suggestion).toContain('throw new HttpError(500, "Internal server error", { cause: err })');
    expect(findings[0].suggestion).toContain("does not expose internal details to API clients");
  });

  it("nested catch: the inner throw is reported once, against the inner variable", () => {
    const findings = runOnFixture("edge/lp002-nested-catch.ts");

    expect(positions(findings)).toEqual([[16, 7, "high", "high"]]);
    expect(findings[0].explanation).toContain("`rollbackError` (caught on line 15)");
  });

  it("A3 combined: with a copied message stays medium; logged first goes down to low", () => {
    const findings = runOnFixture("edge/lp002-no-binding-combined.ts");

    expect(positions(findings)).toEqual([
      [12, 5, "medium", "medium"], // `_err` message copied (P2 + A3)
      [21, 5, "low", "medium"], //    `_err` logged, then a new error (A1 + A3)
    ]);
    expect(findings[0].explanation).toContain("keeps only part of it");
    expect(findings[0].explanation).toContain("Review whether those details could matter");
    expect(findings[1].explanation).toContain("`_err` is logged above");
  });
});

describe("LP002 lost-error-cause: negative fixtures (must NOT report)", () => {
  // Every file in negative/, including LP001's: correct code must stay silent for every rule.
  const negativeFixtures = readdirSync(new URL("./fixtures/negative/", import.meta.url));

  it("has the expected negative fixtures", () => {
    expect(negativeFixtures).toEqual([
      "logs-error.js",
      "lp001-guarded-handled.ts",
      "lp001-handled-near-comments.ts",
      "lp001-test-assertion-handled.spec.ts",
      "lp002-cause-preserved.ts",
      "lp002-other-scopes.ts",
      "lp002-underscore-kept.ts",
      "lp003-handled.js", // added in Milestone 2.5 (LP003's negative fixture; LP002 must stay silent on it too)
      "rethrows.ts",
      "returns-fallback.ts",
      "uses-logger.ts",
    ]);
  });

  it.each(negativeFixtures)("negative/%s has no findings", (fileName) => {
    expect(runOnFixture(`negative/${fileName}`)).toEqual([]);
  });
});

describe("LP002 lost-error-cause: edge cases", () => {
  it("does not report a throw outside any catch block", () => {
    expect(runOnCode("a.ts", 'function f() { throw new Error("x"); }')).toEqual([]);
  });

  it("reports a throw in a finally block inside the catch: it still leaves the catch", () => {
    const code = ["try { f(); } catch (err) {", "  try { g(); } finally {", '    throw new Error("cleanup failed");', "  }", "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[3, 5, "high", "high"]]);
  });

  it("reports a throw inside an inner try that has no catch of its own", () => {
    const code = ["try { f(); } catch (err) {", "  try {", '    throw new Error("x");', "  } finally {", "    cleanup();", "  }", "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[3, 5, "high", "high"]]);
  });

  it("counts a log call only if it runs on the way to the throw", () => {
    const code = ["try { f(); } catch (err) {", "  if (verbose) logger.error({ err });", '  throw new Error("x");', "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[3, 3, "high", "high"]]);
  });

  it("does not count a log call that keeps only the message", () => {
    const code = ["try { f(); } catch (err) {", "  logger.error(err.message);", '  throw new Error("x");', "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[3, 3, "high", "high"]]);
  });

  it("ignores words that only look like the variable: state.err and { err: ... }", () => {
    const code = ["try { f(); } catch (err) {", '  throw new AppError({ err: "x" }, state.err);', "}"];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([[2, 3, "high", "high"]]);
  });

  it("treats (err as Error).message and JSON.stringify(err) as only part of the error", () => {
    const code = [
      "try { f(); } catch (err) {",
      "  if (retry) throw new AppError((err as Error).message);",
      "  throw new AppError(JSON.stringify(err));",
      "}",
    ];

    expect(positions(runOnCode("a.ts", code.join("\n")))).toEqual([
      [2, 14, "medium", "high"],
      [3, 3, "medium", "high"],
    ]);
  });

  it("limits evidence to 5 lines", () => {
    const code = ["try { f(); } catch (err) {", "  throw new Error(", "    [", '      "a",', '      "b",', '      "c",', "    ].join(),", "  );", "}"];
    const findings = runOnCode("a.ts", code.join("\n"));

    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
    expect(findings[0].evidence.split("\n")).toHaveLength(5);
  });

  it("reports correct lines for files with Windows (CRLF) line endings", () => {
    const findings = runOnCode("a.ts", 'try {\r\n  f();\r\n} catch (err) {\r\n  throw new Error("x");\r\n}\r\n');

    expect(positions(findings)).toEqual([[4, 3, "high", "high"]]);
    expect(findings[0].evidence).toBe('  throw new Error("x");');
  });
});

// v0.4.3: the pattern decides which findings the report lists together. Same pattern = one
// explanation fits all, so everything that changes the explanation must change the pattern.
describe("LP002 patterns (grouping repeated findings, v0.4.3)", () => {
  /** The pattern of the one LP002 finding in a catch block with this body. */
  function patternOf(catchHead: string, body: string) {
    const findings = runOnCode("a.ts", `try { load(); } ${catchHead} {\n${body}\n}\n`);
    expect(findings).toHaveLength(1);
    return findings[0].pattern;
  }
  const dropped = patternOf("catch (err)", '  throw new ApiError("Could not load the user");');

  it("is the same for the same thrown class and outcome, whatever the message, variable name or place", () => {
    expect(patternOf("catch (error)", '  throw new ApiError(`Order ${id} failed`, 502);')).toEqual(dropped);
    expect(patternOf("catch (e)", "  throw new ApiError();")).toEqual(dropped);
    expect(patternOf("catch (err)", '  throw new ApiError(\r\n    "split over lines");')).toEqual(dropped);
    expect(dropped?.label).toBe("throw new ApiError(...) without the caught error");
  });

  it("has a stable ID: the rule ID and 8 hex digits, the same on every run and OS", () => {
    expect(dropped?.id).toMatch(/^LP002-[0-9a-f]{8}$/);
    // Pinned value: if this changes, pattern IDs in saved JSON reports change too.
    expect(patternOf("catch (err)", '  throw new Error("x");')?.id).toBe("LP002-dcfb2a11");
  });

  it("differs when anything that changes the explanation differs", () => {
    const others = [
      patternOf("catch (err)", '  throw new NotFoundError("x");'), //            another class
      patternOf("catch (err)", "  throw new ApiError(`x: ${err.message}`);"), // keeps only the text
      patternOf("catch (err)", "  console.error(err);\n  throw new ApiError(\"x\");"), // logged first
      patternOf("catch (err)", '  // the client must not see internals\n  throw new ApiError("x");'), // a comment
      patternOf("catch", '  throw new ApiError("x");'), //                     no variable
      patternOf("catch (_err)", '  throw new ApiError("x");'), //              underscore
      patternOf("catch (err)", '  if (err.code === 1) throw new ApiError("x");'), // guarded
    ];
    for (const other of others) expect(other?.id).not.toBe(dropped?.id);
    expect(new Set(others.map((p) => p?.id)).size).toBe(others.length);
    expect(others.map((p) => p?.label)).toEqual([
      "throw new NotFoundError(...) without the caught error",
      "throw new ApiError(...) that keeps only the caught error's text",
      "throw new ApiError(...) without the caught error, logged before the throw",
      "throw new ApiError(...) without the caught error, with a comment",
      "throw new ApiError(...) without the caught error, the catch has no variable",
      "throw new ApiError(...) without the caught error, the variable starts with _",
      "throw new ApiError(...) without the caught error, under a check of the error",
    ]);
  });

  it("names the options mistake in its label", () => {
    expect(patternOf("catch (err)", '  throw new Error("x", err);')?.label).toBe(
      "new Error(..., caught error): the caught error is passed as options, not as the cause",
    );
  });
});
