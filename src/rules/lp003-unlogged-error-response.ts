// Rule LP003 "unlogged-error-response": an Express handler catches an error and sends an error
// response, but the error itself is never logged, passed on or rethrown.
//
// A catch is reported when (1) it sits directly in an Express handler (see express.ts), not in a
// nested function, (2) its block sends a response through the handler's `res`, and (3) the caught
// error is used for nothing else than the response or a condition: it is not passed to any other
// function (a logger, next(), a helper LogPilot cannot see into), not thrown, returned or stored.
//
// Response helpers defined in the same file, such as `errorResponse(res, 502, "...")`, count as
// responses when they respond through the `res` they receive. When the error is passed to such a
// helper, LP003 looks at what the helper does with it (one level deep): if the helper logs it or
// passes it on, the error is kept. Helpers imported from other files cannot be seen into.

import ts from "typescript";
import type { Confidence, Finding, Severity } from "../types.js";
import { type ExpressHandler, findExpressHandlers, isResponseCall, sameFileFunctions } from "./express.js";
import { getLines } from "./shared.js";

/** Functions defined in the file being checked, by name (for response helpers). */
type Helpers = Map<string, ts.FunctionLikeDeclaration>;

/** A same-file helper that a call passes `res` to, and that responds through it. */
interface HelperResponse {
  fn: ts.FunctionLikeDeclaration & { body: ts.ConciseBody };
  /** The helper's name for the response parameter. */
  res: string;
}

export const RULE_ID = "LP003";
export const RULE_NAME = "unlogged-error-response";
/** The version of this rule's behaviour, shown in JSON output (see LP001 for when to increase it). */
export const RULE_VERSION = 2;

/** Method names of a log call: console.log, logger.error, req.log.warn, ... */
const LOG_METHODS = new Set(["log", "error", "warn", "info", "debug", "trace", "fatal"]);

/** What a handler does with a caught error, when it does not keep it. */
interface Analysis {
  /** The error, or a value made from it, is sent in the response body. */
  errorSent: boolean;
  /** There is a log call, and it does not include the error. */
  logWithoutError: boolean;
  /** Every status code set: a number, or "unknown" when it is not a number literal. */
  statuses: (number | "unknown")[];
}

/** Runs LP003 on one parsed file. */
export function checkUnloggedErrorResponse(sourceFile: ts.SourceFile, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const helpers = sameFileFunctions(sourceFile);
  for (const handler of findExpressHandlers(sourceFile)) {
    const body = (handler.node as ts.FunctionLikeDeclaration).body;
    if (body === undefined) continue;
    if (handler.kind === "error-middleware" && handler.error !== undefined) {
      // Error middleware: every error passed on with next(err) arrives here as the first parameter.
      const analysis = analyse(body, [handler.error], handler.res, helpers);
      if (analysis !== undefined) {
        findings.push(createFinding(handler.node, handler, analysis, handler.error, sourceFile, filePath));
      }
      continue;
    }
    for (const catchClause of catchClausesIn(body)) {
      const analysis = analyse(catchClause.block, bindingNames(catchClause), handler.res, helpers);
      if (analysis !== undefined) {
        const binding = catchClause.variableDeclaration?.name;
        const errorName = binding !== undefined && ts.isIdentifier(binding) ? binding.text : undefined;
        findings.push(createFinding(catchClause, handler, analysis, errorName, sourceFile, filePath));
      }
    }
  }
  return findings;
}

/** Catch clauses in a handler's body, not inside nested functions (they run at another time). */
function catchClausesIn(body: ts.Node): ts.CatchClause[] {
  const found: ts.CatchClause[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCatchClause(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/** The names holding the caught error: [] for `catch {}`, several for `catch ({ message, code })`. */
function bindingNames(catchClause: ts.CatchClause): string[] {
  const name = catchClause.variableDeclaration?.name;
  return name === undefined ? [] : declaredNames(name);
}

function declaredNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? declaredNames(element.name) : []));
}

/**
 * What `scope` (a catch block) does with the error named `errorNames`, or undefined when there is
 * nothing to report: the scope sends no response through `res`, or it keeps the error.
 */
function analyse(scope: ts.Node, errorNames: string[], res: string, helpers: Helpers): Analysis | undefined {
  const calls = callsIn(scope);
  const direct = calls.filter((call) => isResponseCall(call, res));
  const viaHelpers = calls.flatMap((call) => {
    const helper = helperResponse(call, res, helpers);
    return helper === undefined ? [] : [{ call, helper }];
  });
  if (direct.length === 0 && viaHelpers.length === 0) return undefined;

  const use = errorUse(scope, errorNames, res, helpers);
  if (use.kept) return undefined;

  const statuses: Analysis["statuses"] = [];
  for (const call of direct) {
    const method = (call.expression as ts.PropertyAccessExpression).name.text;
    if (method === "status" || method === "sendStatus") statuses.push(statusValue(call.arguments[0]));
  }
  for (const { call, helper } of viaHelpers) statuses.push(...helperStatuses(call, helper));
  return { errorSent: use.sent, logWithoutError: calls.some((call) => isLogCall(call, res)), statuses };
}

/**
 * Whether `scope` keeps the error (passes it to a function, throws, returns or stores it) or sends
 * it in a response. Local variables made from the error (const msg = err.message) are followed too.
 */
function errorUse(scope: ts.Node, errorNames: string[], res: string, helpers: Helpers): { kept: boolean; sent: boolean } {
  const tracked = [...errorNames];
  let sent = false;
  for (let i = 0; i < tracked.length; i++) {
    for (const mention of mentionsIn(scope, tracked[i])) {
      const use = classify(mention, scope, res, helpers);
      if (use.kind === "kept") return { kept: true, sent };
      if (use.kind === "sent") sent = true;
      if (use.kind === "alias") tracked.push(...use.names.filter((name) => !tracked.includes(name)));
    }
  }
  return { kept: false, sent };
}

/** The same-file helper that `call` passes `res` to, when the helper responds through it. */
function helperResponse(call: ts.CallExpression, res: string, helpers: Helpers): HelperResponse | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const fn = helpers.get(call.expression.text);
  if (fn?.body === undefined) return undefined;
  const index = call.arguments.findIndex((argument) => ts.isIdentifier(argument) && argument.text === res);
  const parameter = index === -1 ? undefined : fn.parameters[index]?.name;
  if (parameter === undefined || !ts.isIdentifier(parameter)) return undefined;
  const helperRes = parameter.text;
  const responds = callsIn(fn.body).some((inner) => isResponseCall(inner, helperRes));
  return responds ? { fn: fn as HelperResponse["fn"], res: helperRes } : undefined;
}

/** The status codes a helper call sets: res.status(code) inside it, with `code` read from the call if needed. */
function helperStatuses(call: ts.CallExpression, helper: HelperResponse): Analysis["statuses"] {
  const statuses: Analysis["statuses"] = [];
  for (const inner of callsIn(helper.fn.body)) {
    if (!isResponseCall(inner, helper.res)) continue;
    const method = (inner.expression as ts.PropertyAccessExpression).name.text;
    if (method !== "status" && method !== "sendStatus") continue;
    let argument = inner.arguments[0];
    if (argument !== undefined && ts.isIdentifier(argument)) {
      // res.status(code), where `code` is one of the helper's parameters: take the caller's value.
      const index = helper.fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === (argument as ts.Identifier).text);
      if (index !== -1) argument = call.arguments[index];
    }
    statuses.push(statusValue(argument));
  }
  return statuses;
}

/** Every call expression inside `node`. */
function callsIn(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child)) calls.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

/** Places in `scope` that use the variable `name` (not property names, not the declaration itself). */
function mentionsIn(scope: ts.Node, name: string): ts.Identifier[] {
  const mentions: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && !isNameOnly(node)) mentions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return mentions;
}

/** `b` in `a.b` or `{ b: 1 }`, and the names being declared in `const b = ...` or `({ b }) =>`. */
function isNameOnly(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === identifier) return true;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === identifier) return true;
  return ts.isBindingElement(parent) && (parent.name === identifier || parent.propertyName === identifier);
}

type Use =
  | { kind: "kept" } //      passed to a function, thrown, returned or stored: LogPilot assumes it is handled
  | { kind: "sent" } //      part of the response body
  | { kind: "status" } //    only used to choose the status code
  | { kind: "inspected" } // only read, e.g. in a condition
  | { kind: "alias"; names: string[] }; // copied into a local variable

/** How one mention of the error is used, decided by walking up to `scope`. */
function classify(mention: ts.Identifier, scope: ts.Node, res: string, helpers: Helpers): Use {
  let passedToFunction = false;
  for (let node: ts.Node = mention; node !== scope; node = node.parent) {
    const parent = node.parent;
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.some((a) => a === node)) {
      if (ts.isCallExpression(parent) && isResponseCall(parent, res)) {
        const method = (parent.expression as ts.PropertyAccessExpression).name.text;
        return { kind: method === "status" || method === "sendStatus" ? "status" : "sent" };
      }
      const helper = ts.isCallExpression(parent) ? helperResponse(parent, res, helpers) : undefined;
      if (helper !== undefined && ts.isCallExpression(parent)) {
        // What the same-file helper does with this argument (one level deep: no helpers inside it).
        const parameter = helper.fn.parameters[parent.arguments.indexOf(node as ts.Expression)]?.name;
        if (parameter === undefined || !ts.isIdentifier(parameter)) return { kind: "kept" };
        const inside = errorUse(helper.fn.body, [parameter.text], helper.res, new Map());
        return { kind: inside.kept ? "kept" : inside.sent ? "sent" : "inspected" };
      }
      passedToFunction = true; // keep walking: res.json({ id: String(err) }) still sends it
    } else if (ts.isThrowStatement(parent) || (ts.isReturnStatement(parent) && parent.expression === node)) {
      return { kind: "kept" };
    } else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === node) {
      return { kind: "kept" }; // stored, e.g. res.locals.error = err
    } else if (!passedToFunction && ts.isVariableDeclaration(parent) && parent.initializer === node) {
      return { kind: "alias", names: declaredNames(parent.name) };
    }
  }
  return passedToFunction ? { kind: "kept" } : { kind: "inspected" };
}

/** The status code in res.status(500) / res.sendStatus(500), or "unknown" (e.g. err.status || 500). */
function statusValue(argument: ts.Expression | undefined): number | "unknown" {
  return argument !== undefined && ts.isNumericLiteral(argument) ? Number(argument.text) : "unknown";
}

/** console.log(...), logger.error(...), req.log.warn(...): a call to a log method, not on `res`. */
function isLogCall(call: ts.CallExpression, res: string): boolean {
  const callee = call.expression;
  return ts.isPropertyAccessExpression(callee) && LOG_METHODS.has(callee.name.text) && !isResponseCall(call, res);
}

/**
 * The cases, decided in this order:
 *   E: every status set is 4xx: an unexpected failure (database down) looks like a client error
 *   B: the error is sent to the client only (and may expose internal details)
 *   C: a log line is written, but without the error
 *   D: no error status is set: the failure goes out as 200 OK (or a redirect)
 *   A: an error status (5xx, or one LogPilot cannot read), the error never used
 */
export type Lp003Case = "A" | "B" | "C" | "D" | "E";

function caseOf(analysis: Analysis): Lp003Case {
  const statusClass = classOfStatuses(analysis.statuses);
  if (statusClass === "client") return "E";
  if (analysis.errorSent) return "B";
  if (analysis.logWithoutError) return "C";
  if (statusClass === "none") return "D";
  return "A";
}

/** "server" if any status is 5xx or unreadable, else "client" if any is 4xx, else "none" (no error status). */
function classOfStatuses(statuses: Analysis["statuses"]): "server" | "client" | "none" {
  if (statuses.some((s) => s === "unknown" || s >= 500)) return "server";
  if (statuses.some((s) => s !== "unknown" && s >= 400)) return "client";
  return "none";
}

function levelsOf(theCase: Lp003Case, handler: ExpressHandler): { severity: Severity; confidence: Confidence } {
  // Version 2: case E was medium. On held-out apps all 10 case E findings were debatable (an expected
  // client error, such as a bad token, mixed with rare unexpected ones), so it is now low.
  if (theCase === "E") return { severity: "low", confidence: "medium" };
  if (theCase === "D") return { severity: "high", confidence: "medium" }; // LogPilot cannot be sure the body means failure
  return { severity: "high", confidence: handler.how === "registered" ? "high" : "medium" };
}

/** "status 500", "status 400/409", or "a status LogPilot cannot read". */
function statusLabel(statuses: Analysis["statuses"]): string {
  if (statuses.includes("unknown")) return "a status LogPilot cannot read";
  const numbers = [...new Set(statuses as number[])].sort((a, b) => a - b);
  return `status ${numbers.join("/")}`;
}

/**
 * What request loggers record, from their documentation: morgan logs request fields and `:status`
 * (no token for errors); pino-http logs "request completed" with the response; express-winston's
 * logger logs req/res fields, and its errorLogger only sees errors that reach the error stage.
 */
const REQUEST_LOGGERS =
  " Request loggers such as morgan, pino-http or express-winston record the request and its status code; " +
  "their documentation describes no way to record an error the handler caught itself, and your " +
  "error-handling middleware never sees it, because it is not passed to next(err).";

const MIDDLEWARE_NOTE = " Every error passed on with next(err) ends here, so none of them is recorded.";

const SHAPE_NOTE =
  " LogPilot recognised this function as an Express handler by its (req, res) parameters only, so it is less sure.";

function explain(theCase: Lp003Case, analysis: Analysis, handler: ExpressHandler): string {
  const isMiddleware = handler.kind === "error-middleware";
  const subject = isMiddleware ? "This error-handling middleware" : "This catch";
  const label = statusLabel(analysis.statuses);
  let text: string;
  if (theCase === "A") {
    text =
      `${subject} sends an error response (${label}) but never logs the error` +
      (isMiddleware ? "." : ", passes it to next(err) or rethrows it.") +
      " In production you will see that the request failed, but not why: the error message, stack trace and code are gone.";
  } else if (theCase === "B") {
    text =
      `${subject} sends the error to the client (${label}) but never logs it on the server. The client may see ` +
      "the message, but your logs keep no record of the failure, and the message can expose internal details " +
      "such as database addresses or file paths. (An Error object sent as JSON becomes {}: its message and " +
      "stack are not included.)";
  } else if (theCase === "C") {
    text =
      `${subject} logs a message but not the error itself, then sends an error response (${label}). The log ` +
      "line shows that something failed, not why: the error message, stack trace and code are not in it.";
  } else if (theCase === "D") {
    text =
      `${subject} sends a response without an error status, so the failure goes out as 200 OK (or as a ` +
      "redirect), and the error is never logged. Monitoring and request logs count the request as a success, " +
      "and the reason for the failure is gone.";
  } else {
    text =
      `${subject} answers with a client error (${label}) and never logs the error. ` +
      (isMiddleware ? "Every error that reaches it" : "Every failure inside the try") +
      " gets this answer, including unexpected ones such as a database outage or a bug, which then look like " +
      "a client mistake and leave no trace on the server.";
  }
  text += isMiddleware ? MIDDLEWARE_NOTE : REQUEST_LOGGERS;
  if (handler.how === "shape") text += SHAPE_NOTE;
  return text;
}

function suggest(theCase: Lp003Case, handler: ExpressHandler, errorName: string | undefined): string {
  const name = errorName ?? "err";
  const parameters = (handler.node as ts.FunctionLikeDeclaration).parameters;
  const reqParameter = parameters[handler.kind === "error-middleware" ? 1 : 0]?.name;
  const req = reqParameter !== undefined && ts.isIdentifier(reqParameter) ? reqParameter.text : "req";
  const errKey = name === "err" ? "err" : `err: ${name}`;
  const log = `logger.error({ ${errKey}, path: ${req}.path }, "request failed") (pino) or console.error(${name})`;
  const noSecrets = "never log passwords, tokens or full request bodies.";

  let text: string;
  if (handler.kind === "error-middleware") {
    text = `Log the error here before responding: ${log}. Keep the client message generic in production (optionally with a request ID), and ${noSecrets}`;
  } else if (theCase === "B") {
    text =
      `Log the full error on the server, e.g. ${log}, and send the client a generic message (optionally with a ` +
      `request ID) instead of the error or its message. Also, ${noSecrets}`;
  } else {
    text =
      `Log the error before responding, e.g. ${log}, or pass it on with next(${name}) so your error-handling ` +
      `middleware logs it and answers. Keep the client message generic (optionally with a request ID), and ${noSecrets}`;
    if (theCase === "D") text += " Also send an error status such as res.status(500), so monitoring sees the failure.";
    if (theCase === "E") {
      text +=
        " If only one failure is expected here (such as invalid input), check for it (for example " +
        `if (${name}.name === "ValidationError")) and pass every other error to next(${name}).`;
    }
  }
  if (errorName === undefined && handler.kind !== "error-middleware") {
    text += " This catch does not keep the error in a variable; write `catch (err)` so it can be logged.";
  }
  return text;
}

/** A finding at `reported`: the catch clause, or the whole error middleware function. */
function createFinding(
  reported: ts.Node,
  handler: ExpressHandler,
  analysis: Analysis,
  errorName: string | undefined,
  sourceFile: ts.SourceFile,
  filePath: string,
): Finding {
  const start = sourceFile.getLineAndCharacterOfPosition(reported.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(reported.getEnd());
  const theCase = caseOf(analysis);
  const { severity, confidence } = levelsOf(theCase, handler);
  return {
    ruleId: RULE_ID,
    ruleName: RULE_NAME,
    file: filePath,
    line: start.line + 1,
    column: start.character + 1,
    severity,
    confidence,
    evidence: getLines(sourceFile, start.line, end.line),
    explanation: explain(theCase, analysis, handler),
    suggestion: suggest(theCase, handler, errorName),
  };
}
