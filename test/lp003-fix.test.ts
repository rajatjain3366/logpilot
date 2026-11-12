// Tests for LP003 fix previews (--fix-preview): where the log line goes, what it contains, how it
// follows the file's style, and when no fix is proposed. Every fix shown here also passed
// fix-validate.ts (a failed validation would leave the fix out and return a warning).

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSourceFile, parseSource } from "../src/analyze.js";
import { applyEdits } from "../src/fix-edits.js";
import { attachFixPreviews } from "../src/fixes.js";
import type { Finding } from "../src/types.js";

/** Runs every rule with fix previews on `code`; returns the findings and the validation warnings. */
function scan(fileName: string, code: string, hasSyntaxErrors = false) {
  const sourceFile = parseSource(fileName, code);
  const { kept } = checkSourceFile(sourceFile, fileName);
  const warnings = attachFixPreviews(sourceFile, fileName, kept, hasSyntaxErrors);
  return { findings: kept, warnings, sourceFile };
}

function scanFixture(name: string) {
  const code = readFileSync(new URL(`./fixtures/fix/${name}`, import.meta.url), "utf8");
  return { ...scan(`fix/${name}`, code), code };
}

/** Each edit as "line N: <text>", where N is the 1-based line of the ORIGINAL file it is inserted on. */
function inserts(finding: Finding, code: string): string[] {
  const sourceFile = parseSource("x.js", code);
  return (finding.fix?.edits ?? []).map((e) => `line ${sourceFile.getLineAndCharacterOfPosition(e.start).line + 1}: ${e.newText}`);
}

const LOG = (err: string, req = "req") => `console.error("Request failed:", { method: ${req}.method, route: ${req}.route?.path }, ${err});`;

/** A registered handler; the catch is `catch <binding> {` on line 6 and its block is `body` (lines 7 on). */
function handler(body: string[], binding = "(err)", eol = "\n"): string {
  return [
    'const express = require("express");',
    "const app = express();",
    'app.get("/users/:id", async (req, res) => {',
    "  try {",
    "    res.json(await load(req.params.id));",
    `  } catch ${binding} {`,
    ...body.map((line) => `    ${line}`),
    "  }",
    "});",
    "",
  ].join(eol);
}

describe("LP003 fix previews: where the log line goes (fixture fix/lp003-console-cases.js)", () => {
  const { findings, warnings, code } = scanFixture("lp003-console-cases.js");
  const byLine = (line: number) => {
    const finding = findings.find((f) => f.ruleId === "LP003" && f.line === line);
    expect(finding, `an LP003 finding on line ${line}`).toBeDefined();
    return finding!;
  };

  it("finds every case, and every proposed fix passes validation", () => {
    expect(findings.map((f) => `${f.ruleId}:${f.line}`)).toEqual(
      ["13", "27", "38", "47", "55", "63", "72", "81", "90", "108", "117", "122"].map((line) => `LP003:${line}`),
    );
    expect(warnings).toEqual([]);
  });

  it("puts the line before the single 500 response, above the comment that belongs to it", () => {
    expect(inserts(byLine(13), code)).toEqual([`line 17:     ${LOG("err")}\n`]);
    expect(byLine(13).fix?.description).toBe("Log the caught error with console.error just before the error response on line 18.");
  });

  it("gives `catch {}` a variable that the block does not already use: err, then error, then caughtError", () => {
    expect(inserts(byLine(27), code)).toEqual(["line 27:  (error)", `line 28:     ${LOG("error")}\n`]);
    expect(inserts(byLine(38), code)).toEqual(["line 38:  (caughtError)", `line 39:     ${LOG("caughtError")}\n`]);
    expect(byLine(27).fix?.description).toContain("The catch gets a variable for the error: catch (error).");
  });

  it("goes to the start of the catch block when the 500 is an unbraced else branch, and says it also logs the 4xx", () => {
    expect(inserts(byLine(47), code)).toEqual([`line 48:     ${LOG("error")}\n`]);
    expect(byLine(47).fix?.description).toBe("Log the caught error with console.error at the start of the catch block.");
    expect(byLine(47).fix?.notes[0]).toMatch(/^The log line is at the start of the block, so it also logs failures that this code answers as expected/);
  });

  it("stays on the same line in a one-line catch", () => {
    expect(inserts(byLine(55), code)).toEqual([`line 55: ${LOG("err")} `]);
  });

  it("goes into the switch's default case, a same-file helper's call, and error middleware (with `_req`)", () => {
    expect(inserts(byLine(90), code)).toEqual([`line 95:         ${LOG("err")}\n`]);
    expect(inserts(byLine(108), code)).toEqual([`line 109:     ${LOG("err")}\n`]);
    expect(inserts(byLine(117), code)).toEqual([`line 118:   ${LOG("err", "_req")}\n`]);
    expect(byLine(117).fix?.description).toBe("Log the caught error with console.error just before the error response on line 118.");
  });

  it("proposes no fix for a 4xx-only answer, an unpacked error, or middleware without braces, and says why", () => {
    expect(byLine(72).fix).toMatchObject({ status: "not-available", edits: [] });
    expect(byLine(72).fix?.reason).toMatch(/^No fix for a 4xx answer \(case E\)\./);
    expect(byLine(81).fix?.reason).toMatch(/^No fix: this catch unpacks the error \(catch \(\{ message \}\)\)/);
    expect(byLine(122).fix?.reason).toMatch(/^No fix: this error middleware is an arrow function without braces/);
  });

  it("never changes the response: the fixed file keeps every original line", () => {
    for (const finding of findings.filter((f) => f.fix?.status === "available")) {
      const fixed = applyEdits(code, finding.fix!.edits);
      for (const line of code.split("\n")) {
        if (!line.includes("catch")) expect(fixed).toContain(line); // the catch line may gain a variable
      }
    }
  });
});

describe("LP003 fix previews: the log line never contains secrets or personal data", () => {
  const fixtures = readdirSync(new URL("./fixtures/fix/", import.meta.url));
  const allFixes = fixtures.flatMap((name) => scanFixture(name).findings.flatMap((f) => (f.fix?.status === "available" ? [f.fix] : [])));

  it("has fixes to check (so the checks below are not empty)", () => {
    expect(allFixes.length).toBeGreaterThanOrEqual(12);
  });

  it("only inserts text: no fix removes or replaces anything", () => {
    for (const fix of allFixes) for (const edit of fix.edits) expect(edit.end).toBe(edit.start);
  });

  it("never reads the body, headers, query string, cookies, URL, path, params, ip, user or req.log", () => {
    const forbidden = /\.(body|headers?|query|cookies|signedCookies|originalUrl|url|baseUrl|path(?<!route\?\.path)|params|ip|ips|user|session|log|get)\b/;
    for (const fix of allFixes) {
      for (const edit of fix.edits) {
        expect(edit.newText.replace(/\.route\?\.path/g, "")).not.toMatch(forbidden);
      }
    }
  });

  it("uses no request property other than method and route?.path (the fixture's handler uses many)", () => {
    const { findings, code } = scanFixture("lp003-console-cases.js");
    const search = findings.find((f) => f.line === 63)!;
    expect(code).toContain("req.headers.authorization");
    expect(inserts(search, code)).toEqual([`line 64:     ${LOG("err")}\n`]);
  });
});

describe("LP003 fix previews: following the file's style", () => {
  it("copies tabs, single quotes and the missing semicolons (fixture fix/lp003-style.js)", () => {
    const { findings, code } = scanFixture("lp003-style.js");
    expect(inserts(findings[0], code)).toEqual([
      "line 12: \t\tconsole.error('Request failed:', { method: req.method, route: req.route?.path }, err)\n",
    ]);
  });

  it("adds a semicolon anyway when the next line starts with ( and would otherwise join the log line", () => {
    const code = handler(["(res.status(500)).send('Failed')"]).replace(/;\n/g, "\n").replace(/"/g, "'");
    const [finding] = scan("a.js", code).findings;
    expect(finding.fix?.edits[0].newText).toBe(`    ${LOG("err").replace(/"/g, "'")}\n`);
  });

  it("uses \\r\\n in a CRLF file, and the line ending of the line above in a file with mixed endings", () => {
    const crlf = handler(['res.status(500).json({ message: "Server error" });'], "(err)", "\r\n");
    expect(scan("a.js", crlf).findings[0].fix?.edits[0].newText).toBe(`    ${LOG("err")}\r\n`);

    const mixed = handler(['res.status(500).json({ message: "Server error" });']).replace("  } catch (err) {\n", "  } catch (err) {\r\n");
    expect(scan("b.js", mixed).findings[0].fix?.edits[0].newText).toBe(`    ${LOG("err")}\r\n`);
  });

  it("works in TypeScript with a typed `catch (error: unknown)` (fixture fix/lp003-typescript.ts)", () => {
    const { findings, code, warnings } = scanFixture("lp003-typescript.ts");
    expect(warnings).toEqual([]);
    expect(inserts(findings[0], code)).toEqual([`line 12:     ${LOG("error")}\n`]);
  });
});

describe("LP003 fix previews: axios errors contain the request's headers", () => {
  const { findings, code } = scanFixture("lp003-axios.js");

  it("proposes no fix when the try block calls axios, directly or through axios.create()", () => {
    for (const line of [15, 24]) {
      expect(findings.find((f) => f.line === line)?.fix?.reason).toBe(
        "No fix: the try block calls axios. axios errors contain the request's headers, including Authorization, so " +
          "logging the whole error would write credentials to your logs. Log selected fields instead, and never err.config.",
      );
    }
  });

  it("proposes a fix with a note when the file imports axios but the try block does not call it", () => {
    const local = findings.find((f) => f.line === 33)!;
    expect(inserts(local, code)).toEqual([`line 34:     ${LOG("err")}\n`]);
    expect(local.fix?.notes).toEqual([
      "This file imports axios. If an axios error can reach this code, logging it whole writes the request's headers, " +
        "including Authorization, to your logs: check that your logger redacts them.",
    ]);
  });

  it("recognises an ES module import of axios too", () => {
    const code = handler(["res.status(502).end();"]).replace('const express = require("express");', 'import express from "express";\nimport http from "axios";').replace("await load(req.params.id)", "(await http.get('/x')).data");
    expect(scan("a.mjs", code).findings[0].fix?.reason).toMatch(/^No fix: the try block calls axios\./);
  });
});

describe("LP003 fix previews: when the log line could mean something else, there is no fix", () => {
  it("refuses when the block declares its own `req` (the log line would read it, or fail before it exists)", () => {
    const code = handler(['const req = "cached";', "res.status(500).end(req);"]);
    expect(scan("a.js", code).findings[0].fix?.reason).toBe(
      "No fix: this block declares its own variable named `req`, which the log line would use. Add the log line by hand.",
    );
  });

  it("refuses when the file declares its own `console`", () => {
    const code = 'const console = require("./my-console");\n' + handler(["res.status(500).end();"]);
    expect(scan("a.js", code).findings[0].fix?.reason).toMatch(/^No fix: this file declares its own `console`/);
  });

  it("gives no fix in a file with syntax errors", () => {
    const { findings } = scan("a.js", handler(["res.status(500).end();"]), true);
    expect(findings[0].fix?.reason).toBe("No fix: the file has syntax errors, so LogPilot cannot check a fix.");
  });

  it("explains why LP001 and LP002 findings get no fix", () => {
    const code = "try { a(); } catch (e) {}\ntry { b(); } catch (err) { throw new Error('Failed'); }\n";
    const [lp001, lp002] = scan("a.js", code).findings;
    expect(lp001.fix?.reason).toMatch(/^No automatic fix for an empty catch: it needs a human decision/);
    expect(lp002.fix?.reason).toMatch(/preserve-caught-error/);
  });
});
