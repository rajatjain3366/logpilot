// Tests for fix validation: a proposed fix is shown only when it inserts text only, parses, uses
// only safe names, removes its finding and changes nothing else. The fixes here are hand-written
// edits, so each test controls exactly what is being checked.

import { describe, expect, it } from "vitest";
import { checkSourceFile, parseSource } from "../src/analyze.js";
import { validateFix, validateFixSet, type FixSafety } from "../src/fix-validate.js";
import type { Finding, TextEdit } from "../src/types.js";

const HANDLER = [
  'const express = require("express");',
  "const router = express.Router();",
  'router.get("/users/:id", async (req, res) => {',
  "  try {",
  "    res.json(await load(req.params.id));",
  "  } catch (err) {",
  '    res.status(500).json({ message: "Server error" });',
  "  }",
  "});",
  "",
].join("\n");

const SAFETY: FixSafety = { errorName: "err", requestName: "req", loggerName: "console" };

/** The one LP003 finding in `code`. */
function lp003Finding(code: string): Finding {
  const { kept } = checkSourceFile(parseSource("app.js", code), "app.js");
  const findings = kept.filter((f) => f.ruleId === "LP003");
  expect(findings).toHaveLength(1);
  return findings[0];
}

/** An edit that inserts `line` (plus indentation and a new line) before the line that starts with `before`. */
function insertLineBefore(code: string, before: string, line: string): TextEdit {
  const start = code.indexOf(before);
  const lineStart = code.lastIndexOf("\n", start) + 1;
  return { start: lineStart, end: lineStart, newText: `    ${line}\n` };
}

function validate(code: string, edits: TextEdit[], safety = SAFETY) {
  return validateFix("app.js", "app.js", code, lp003Finding(code), edits, safety);
}

const SAFE_LINE = 'console.error("Request failed:", { method: req.method, route: req.route?.path }, err);';

describe("validateFix: fixes that may be shown", () => {
  it("accepts a log line with the error, req.method and req.route?.path", () => {
    expect(validate(HANDLER, [insertLineBefore(HANDLER, "res.status(500)", SAFE_LINE)])).toBeUndefined();
  });

  it("accepts a fix that adds a variable to `catch {}`", () => {
    const code = HANDLER.replace("catch (err)", "catch");
    const at = code.indexOf("catch") + "catch".length;
    const edits = [{ start: at, end: at, newText: " (err)" }, insertLineBefore(code, "res.status(500)", SAFE_LINE)];
    expect(validate(code, edits)).toBeUndefined();
  });
});

describe("validateFix: fixes that are refused, with the reason", () => {
  it("refuses an edit that removes or replaces existing code", () => {
    const start = HANDLER.indexOf('"Server error"');
    const edits = [{ start, end: start + 14, newText: '"Failed"' }];
    expect(validate(HANDLER, edits)).toBe("the fix would remove or change existing code (LogPilot's fixes only insert text)");
  });

  it("refuses a fix whose code would not parse", () => {
    expect(validate(HANDLER, [insertLineBefore(HANDLER, "res.status(500)", "console.error(err")])).toMatch(/^the fixed code would not parse \(/);
  });

  it("refuses any fix in a file that already has syntax errors", () => {
    const broken = HANDLER + "const = ;\n";
    const finding = lp003Finding(HANDLER); // same position in both texts
    expect(validateFix("app.js", "app.js", broken, finding, [insertLineBefore(broken, "res.status(500)", SAFE_LINE)], SAFETY)).toBe(
      "the file has syntax errors, so LogPilot cannot check a fix",
    );
  });

  it("refuses a fix after which the finding is still reported", () => {
    expect(validate(HANDLER, [insertLineBefore(HANDLER, "res.status(500)", "// TODO log")])).toBe("LP003 still reports this code after the fix");
  });

  it("refuses a fix that makes another rule report something new", () => {
    // Logs the error, but adds an empty catch (LP001). It is low: inside a catch whose error is passed on.
    const line = "try { console.error(err); } catch {}";
    expect(validate(HANDLER, [insertLineBefore(HANDLER, "res.status(500)", line)])).toBe(
      "the fix would make LogPilot report something new: LP001 at line 7:33 (low/high)",
    );
  });

  it("refuses a fix that moves a logpilot-ignore comment away from the line it hides", () => {
    const code = HANDLER.replace(
      '    res.status(500).json({ message: "Server error" });',
      [
        "    // logpilot-ignore-next-line LP001 -- cleanup failures are harmless here",
        "    try { cleanup(); } catch {}",
        '    res.status(500).json({ message: "Server error" });',
      ].join("\n"),
    );
    // Inserted between the comment and the line it hides: the empty catch is reported again.
    expect(validate(code, [insertLineBefore(code, "try { cleanup", "console.error(err);")])).toBe(
      "the fix would make LogPilot report something new: LP001 at line 9:24 (low/high)",
    );
  });
});

describe("validateFix: the inserted code may never log secrets or personal data", () => {
  const refused = (line: string) => validate(HANDLER, [insertLineBefore(HANDLER, "res.status(500)", line)]);

  it.each([
    ["console.error(req.body, err);", '"body"'],
    ["console.error({ headers: req.headers }, err);", '"headers"'],
    ['console.error(req.get("authorization"), err);', '".get("'],
    ["console.error(req.query, err);", '"query"'],
    ["console.error(req.cookies, err);", '"cookies"'],
    ["console.error(req.originalUrl, err);", '"originalUrl"'],
    ["console.error(req.url, err);", '"url"'],
    ["console.error(req.params, err);", '"params"'],
    ["console.error(req.ip, err);", '"ip"'],
    ["console.error(req.user, err);", '"user"'],
  ])("refuses %s", (line, word) => {
    expect(refused(line)).toBe(`the fix's code would use ${word}, which LogPilot never logs`);
  });

  it("refuses request properties outside the allowlist, even ones not in the forbidden word list", () => {
    expect(refused("console.error(req.path, err);")).toBe("the fix's code would use req.path");
    expect(refused("req.log.error({ err }, 'Request failed');")).toBe("the fix's code would use req.log");
    expect(refused("console.error(req.route.stack, err);")).toBe("the fix's code would use req.route.stack");
  });

  it("refuses other variables, computed property access, other logger methods and other context keys", () => {
    expect(refused("console.error(process.env, err);")).toBe('the fix\'s code would use "process"');
    expect(refused('console.error(req["method"], err);')).toBe('the fix\'s code would use req["method"]');
    expect(refused("console.log(err);")).toBe("the fix's code would use console.log");
    expect(refused("console.error({ status: 500 }, err);")).toBe('the fix\'s code would log a field named "status"');
  });

  it("allows forbidden words inside the log message string", () => {
    expect(refused('console.error("Request failed (body not logged):", err);')).toBeUndefined();
  });
});

// Milestone 4: `logpilot fix` writes all fixes accepted for one file at once, so they are checked together.
describe("validateFixSet: several fixes for one file, checked together", () => {
  const TWO = [
    'const express = require("express");',
    "const router = express.Router();",
    'router.get("/users/:id", async (req, res) => {',
    "  try {",
    "    res.json(await load(req.params.id));",
    "  } catch (err) {",
    '    res.status(500).json({ message: "Server error" });',
    "  }",
    "});",
    'router.post("/orders", async (req, res) => {',
    "  try {",
    "    res.json(await save());",
    "  } catch (error) {",
    '    res.status(500).json({ message: "Could not save" });',
    "  }",
    "});",
    "",
  ].join("\n");
  const findings = () => checkSourceFile(parseSource("app.js", TWO), "app.js").kept.filter((f) => f.ruleId === "LP003");
  /** An edit that inserts `line` before the n-th (0-based) line that contains `marker`. */
  function insertBefore(marker: string, n: number, line: string): TextEdit {
    let at = -1;
    for (let i = 0; i <= n; i++) at = TWO.indexOf(marker, at + 1);
    const lineStart = TWO.lastIndexOf("\n", at) + 1;
    return { start: lineStart, end: lineStart, newText: `    ${line}\n` };
  }
  const fixErr = () => ({
    finding: findings()[0],
    edits: [insertBefore("res.status(500)", 0, 'console.error("Request failed:", { method: req.method, route: req.route?.path }, err);')],
    safety: { errorName: "err", requestName: "req", loggerName: "console" },
  });
  const fixError = (line = 'console.error("Request failed:", { method: req.method, route: req.route?.path }, error);') => ({
    finding: findings()[1],
    edits: [insertBefore("res.status(500)", 1, line)],
    safety: { errorName: "error", requestName: "req", loggerName: "console" },
  });

  it("accepts two fixes that are fine together, each with its own error name", () => {
    expect(findings()).toHaveLength(2);
    expect(validateFixSet("app.js", "app.js", TWO, [fixErr(), fixError()])).toBeUndefined();
  });

  it("checks each fix's inserted code against that fix's own safe names", () => {
    // `err` is safe in the first fix, but in the second fix's catch the error is called `error`.
    const wrongName = fixError('console.error("Request failed:", err);');
    expect(validateFixSet("app.js", "app.js", TWO, [fixErr(), wrongName])).toBe('the fix\'s code would use "err"');
  });

  it("refuses the whole set when one fix logs something unsafe", () => {
    const unsafe = fixError("console.error(req.body, error);");
    expect(validateFixSet("app.js", "app.js", TWO, [fixErr(), unsafe])).toBe('the fix\'s code would use "body", which LogPilot never logs');
  });

  it("refuses the set when a finding it claims to fix is still reported", () => {
    const noEdit = { ...fixError(), edits: [] };
    expect(validateFixSet("app.js", "app.js", TWO, [fixErr(), noEdit])).toBe("LP003 still reports this code after the fix");
  });

  it("refuses overlapping edits", () => {
    const same = fixErr();
    expect(validateFixSet("app.js", "app.js", TWO, [same, { ...fixError(), edits: same.edits.map((e) => ({ ...e })) }])).toMatch(/^the fix's edits are invalid: edits .* overlap$/);
  });
});
