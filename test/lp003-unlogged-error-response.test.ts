// Unit tests for rule LP003 (unlogged-error-response).
// Positive fixtures contain code the rule MUST report; negative fixtures contain code it must NOT
// report; edge fixtures are reported with a lower severity or confidence.

import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkUnloggedErrorResponse } from "../src/rules/lp003-unlogged-error-response.js";

function runOnCode(fileName: string, code: string) {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  return checkUnloggedErrorResponse(sourceFile, fileName);
}

function runOnFixture(relativePath: string) {
  const code = readFileSync(new URL(`./fixtures/${relativePath}`, import.meta.url), "utf8");
  return runOnCode(relativePath, code);
}

/** [line, column] for each finding. */
function at(findings: ReturnType<typeof runOnCode>) {
  return findings.map((f) => [f.line, f.column]);
}

/** A registered Express handler whose catch (line 6, column 5) has the given body. */
function inHandler(catchBody: string, binding = "(err)"): string {
  return [
    'const express = require("express");',
    "const app = express();",
    'app.get("/", async (req, res) => {',
    "  try {",
    "    await work();",
    `  } catch ${binding} { ${catchBody} }`,
    "});",
  ].join("\n");
}

describe("LP003 catch analysis: a handler's catch responds, and the error is not kept", () => {
  it("reports every catch in the positive fixture (cases A to D)", () => {
    const findings = runOnFixture("positive/lp003-error-responses.js");

    expect(at(findings)).toEqual([
      [14, 5], // 500, error unused
      [24, 5], // sendStatus(500), catch without a variable
      [33, 5], // status chosen from the error
      [42, 5], // err.message sent to the client
      [51, 5], // the error object sent through a local variable
      [61, 5], // a log line without the error
      [71, 5], // no status: 200 OK
      [80, 5], // error page rendered without a status
    ]);
    for (const finding of findings) {
      expect(finding.ruleId).toBe("LP003");
      expect(finding.ruleName).toBe("unlogged-error-response");
      expect(finding.file).toBe("positive/lp003-error-responses.js");
    }
  });

  it("reports 4xx responses and handlers recognised only by their shape (edge fixture)", () => {
    expect(at(runOnFixture("edge/lp003-client-errors-and-shapes.js"))).toEqual([
      [14, 5], // 400
      [23, 5], // 404 with err.message
      [32, 5], // exported controller (shape)
      [42, 7], // class method (shape)
    ]);
  });

  it("follows the error through local variables, but treats any other function call as handling it", () => {
    expect(at(runOnCode("a.js", inHandler("const msg = err.message; res.status(500).json({ msg });")))).toEqual([[6, 5]]);
    expect(at(runOnCode("b.js", inHandler("const { message } = err; res.status(500).send(message);")))).toEqual([[6, 5]]);
    expect(at(runOnCode("c.js", inHandler("const report = format(err); res.status(500).json({ report });")))).toEqual([]);
  });

  // Pins today's behaviour (Milestone 2.5 second-labeller check): logging only the error's message
  // counts as logging the error. The stack is lost, but that weak context is for a future rule.
  it("counts a log call with only the error's message as logging the error (not reported)", () => {
    const direct = 'console.error("Load failed:", err.message); res.status(500).end();';
    const viaAlias = "const msg = err.message; logger.error(msg); res.status(500).end();";

    expect(runOnCode("a.js", inHandler(direct))).toEqual([]);
    expect(runOnCode("b.js", inHandler(viaAlias))).toEqual([]);
  });

  it("does not report a catch that sends no response", () => {
    expect(runOnCode("a.js", inHandler("cache = null;"))).toEqual([]);
  });

  it("does not report anything in any negative fixture", () => {
    const negatives = readdirSync(new URL("./fixtures/negative/", import.meta.url));
    expect(negatives).toContain("lp003-handled.js");
    for (const fixture of negatives) {
      expect([fixture, runOnFixture(`negative/${fixture}`)]).toEqual([fixture, []]);
    }
  });
});

describe("LP003 error middleware: (err, req, res, next) responds without using err", () => {
  it("reports error middleware that responds without keeping the error (positive fixture)", () => {
    expect(at(runOnFixture("positive/lp003-error-middleware.js"))).toEqual([
      [9, 9], //  generic 500
      [14, 9], // status and message from the error, never logged
      [19, 9], // arrow function without braces
    ]);
  });

  it("reports error middleware recognised only by its shape (edge fixture)", () => {
    expect(at(runOnFixture("edge/lp003-error-middleware-shape.js"))).toEqual([[4, 18]]);
  });

  it("reports middleware that only inspects the error before responding", () => {
    const code = [
      'const express = require("express");',
      "const app = express();",
      "app.use((err, req, res, next) => {",
      '  if (err.name === "UnauthorizedError") return res.status(401).end();',
      "  res.status(500).end();",
      "});",
    ];

    expect(at(runOnCode("a.js", code.join("\n")))).toEqual([[3, 9]]);
  });

  it("needs four parameters: Express treats (err, req, res) as ordinary middleware (never reported)", () => {
    const code = ['const express = require("express");', "const app = express();", "app.use((err, req, res) => res.status(500).end());"];

    expect(runOnCode("a.js", code.join("\n"))).toEqual([]);
  });
});

/** [line, severity, confidence] for each finding. */
function levels(findings: ReturnType<typeof runOnCode>) {
  return findings.map((f) => [f.line, f.severity, f.confidence]);
}

describe("LP003 severity and confidence: cases A to E", () => {
  it("gives registered handlers high severity, and high confidence except for case D (no status)", () => {
    expect(levels(runOnFixture("positive/lp003-error-responses.js"))).toEqual([
      [14, "high", "high"], //   A: 500, error unused
      [24, "high", "high"], //   A: sendStatus(500), catch {}
      [33, "high", "high"], //   A: status LogPilot cannot read
      [42, "high", "high"], //   B: err.message sent
      [51, "high", "high"], //   B: error object sent
      [61, "high", "high"], //   C: log line without the error
      [71, "high", "medium"], // D: 200 with { success: false }
      [80, "high", "medium"], // D: error page without a status
    ]);
  });

  // CHANGED ON PURPOSE (LP003 version 2, Milestone 2.5): case E was "medium" severity. In the held-out
  // measurement all 10 case E findings were debatable, so its severity is now low. Confidence is unchanged.
  it("gives 4xx responses low / medium (case E), and shape-only handlers confidence medium", () => {
    expect(levels(runOnFixture("edge/lp003-client-errors-and-shapes.js"))).toEqual([
      [14, "low", "medium"], // E: 400
      [23, "low", "medium"], // E: 404 with err.message
      [32, "high", "medium"], //   A, shape only
      [42, "high", "medium"], //   B, shape only
    ]);
  });

  it("rates error middleware the same way", () => {
    expect(levels(runOnFixture("positive/lp003-error-middleware.js"))).toEqual([
      [9, "high", "high"], //  A
      [14, "high", "high"], // B
      [19, "high", "high"], // B
    ]);
    expect(levels(runOnFixture("edge/lp003-error-middleware-shape.js"))).toEqual([[4, "high", "medium"]]);
  });

  it("uses the most severe status in the catch: any 5xx or unreadable status beats 4xx, 4xx beats 2xx", () => {
    const mixed = 'if (err.code === 11000) return res.status(409).json({ message: "Exists" }); res.status(500).end();';
    const clientOnly = 'if (err.code === 11000) return res.status(409).end(); res.status(400).end();';
    const okStatus = "res.status(200).json({ ok: false });";

    expect(levels(runOnCode("a.js", inHandler(mixed)))).toEqual([[6, "high", "high"]]);
    // CHANGED ON PURPOSE (LP003 version 2): case E severity was "medium".
    expect(levels(runOnCode("b.js", inHandler(clientOnly)))).toEqual([[6, "low", "medium"]]);
    expect(levels(runOnCode("c.js", inHandler(okStatus)))).toEqual([[6, "high", "medium"]]);
  });
});

describe("LP003 explanations and suggestions", () => {
  const positive = runOnFixture("positive/lp003-error-responses.js");
  const edge = runOnFixture("edge/lp003-client-errors-and-shapes.js");
  const middleware = runOnFixture("positive/lp003-error-middleware.js");

  it("opens with a sentence that names the case", () => {
    expect(positive[0].explanation).toMatch(/^This catch sends an error response \(status 500\) but never logs the error, passes it to next\(err\) or rethrows it\./);
    expect(positive[2].explanation).toContain("(a status LogPilot cannot read)");
    expect(positive[3].explanation).toMatch(/^This catch sends the error to the client \(status 500\) but never logs it on the server\./);
    expect(positive[5].explanation).toMatch(/^This catch logs a message but not the error itself/);
    expect(positive[6].explanation).toMatch(/^This catch sends a response without an error status, so the failure goes out as 200 OK/);
    expect(edge[0].explanation).toMatch(/^This catch answers with a client error \(status 400\) and never logs the error\./);
    expect(middleware[0].explanation).toMatch(/^This error-handling middleware sends an error response \(status 500\) but never logs the error\./);
    expect(middleware[1].explanation).toMatch(/^This error-handling middleware sends the error to the client/);
  });

  it("says what request loggers and error middleware can and cannot see", () => {
    expect(positive[0].explanation).toContain(
      "Request loggers such as morgan, pino-http or express-winston record the request and its status code; " +
        "their documentation describes no way to record an error the handler caught itself",
    );
    expect(positive[0].explanation).toContain("your error-handling middleware never sees it, because it is not passed to next(err)");
    expect(middleware[0].explanation).toContain("Every error passed on with next(err) ends here, so none of them is recorded");
  });

  it("warns that a sent message can expose internals, and that an Error object becomes {} in JSON", () => {
    expect(positive[3].explanation).toContain("can expose internal details");
    expect(positive[3].explanation).toContain("An Error object sent as JSON becomes {}");
  });

  it("says when the handler was recognised by its parameters only", () => {
    expect(edge[2].explanation).toContain("LogPilot recognised this function as an Express handler by its (req, res) parameters only");
    expect(positive[0].explanation).not.toContain("parameters only");
  });

  it("suggests logging with the real variable name, or next(err), and never logging secrets", () => {
    expect(positive[0].suggestion).toContain("logger.error({ err, path: req.path }");
    expect(positive[0].suggestion).toContain("next(err)");
    expect(positive[0].suggestion).toContain("never log passwords, tokens or full request bodies");
    expect(positive[2].suggestion).toContain("logger.error({ err: error, path: req.path }"); // catch (error)
    expect(positive[1].suggestion).toContain("write `catch (err)`"); //                        catch {}
    expect(positive[0].suggestion).not.toContain("write `catch (err)`");
  });

  it("adapts the suggestion to the case", () => {
    expect(positive[3].suggestion).toContain("send the client a generic message (optionally with a request ID) instead of the error or its message");
    expect(positive[6].suggestion).toContain("send an error status such as res.status(500)");
    expect(edge[0].suggestion).toContain('check for it (for example if (err.name === "ValidationError")) and pass every other error to next(err)');
    expect(middleware[0].suggestion).toContain("Log the error here before responding");
  });
});

describe("LP003 tuning change 1: responses through a helper defined in the same file", () => {
  it("counts a same-file helper that receives res and responds as a response", () => {
    expect(levels(runOnFixture("positive/lp003-response-helpers.js"))).toEqual([
      [20, "high", "high"], // catch {} + errorResponse(res, 502, ...): case A
      [29, "high", "high"], // bad(res, 502, err.message): case B
      [35, "high", "high"], // error middleware answering through the helper: case A
    ]);
  });

  it("reads the status from the helper call, and what the helper does with the error", () => {
    const [first, second, third] = runOnFixture("positive/lp003-response-helpers.js");

    expect(first.explanation).toMatch(/^This catch sends an error response \(status 502\)/);
    expect(second.explanation).toMatch(/^This catch sends the error to the client \(status 502\)/);
    expect(third.explanation).toMatch(/^This error-handling middleware sends an error response \(status 400\/500\)/);
  });

  it("treats the error as kept when the same-file helper logs it (negative fixture, handler /l)", () => {
    const code = readFileSync(new URL("./fixtures/negative/lp003-handled.js", import.meta.url), "utf8");
    expect(code).toContain("return fail(res, error, \"List users\");");
    expect(runOnFixture("negative/lp003-handled.js")).toEqual([]);
  });
});
