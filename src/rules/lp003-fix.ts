// Fix previews for LP003 (unlogged-error-response): a log line for the caught error, inserted
// before the error response. A proposal is only TEXT EDITS; nothing here reads or writes files.
// Every proposal is checked by fix-validate.ts before it is shown.
//
// What a fix inserts (README "Fix previews"):
//   console.error("Request failed:", { method: req.method, route: req.route?.path }, err);
// - the whole error, under the catch's real variable name (a `catch {}` gets one: `catch (err)`);
// - as context only req.method and req.route?.path, the route PATTERN such as "/users/:id".
//   Never the body, headers, query string, cookies or URL: they can hold tokens and personal data.
// - It goes before the one statement that sends a 5xx response, so expected failures answered
//   with a 4xx are not logged; otherwise at the start of the catch block (or error middleware).
// - Its indentation, line ending, quotes and semicolons follow the file.
// The response itself is never changed, so clients receive exactly what they did before.

import ts from "typescript";
import type { FixSafety } from "../fix-validate.js";
import type { FixPreview, TextEdit } from "../types.js";
import { chooseLogger, type LoggerChoice, type ReadFile } from "./loggers.js";
import { findLp003Targets, type Lp003Target, reportedPosition, serverErrorResponses } from "./lp003-unlogged-error-response.js";

/** A proposed fix for one LP003 finding, or the reason there is none. */
export type Lp003Proposal =
  | {
      ok: true;
      edits: TextEdit[];
      description: string;
      logger: NonNullable<FixPreview["logger"]>;
      notes: string[];
      /** The names the inserted code uses, for validation. */
      safety: FixSafety;
    }
  | { ok: false; reason: string };

const REASON_CLIENT_ERROR =
  "No fix for a 4xx answer (case E). The right change is to tell the expected failure (such as invalid input or a " +
  "bad token) apart from unexpected ones, and that needs a human. Logging every 4xx answer here as an error would " +
  "also log normal client mistakes.";
const REASON_EXPRESSION_BODY =
  "No fix: this error middleware is an arrow function without braces, and LogPilot does not rewrite it into a block. " +
  "Add braces and log the error first.";
const REASON_UNPACKED =
  "No fix: this catch unpacks the error (catch ({ message })), so the whole error is not available to log. " +
  "Write catch (err) and log err.";
const REASON_AXIOS =
  "No fix: the try block calls axios. axios errors contain the request's headers, including Authorization, so logging " +
  "the whole error would write credentials to your logs. Log selected fields instead, and never err.config.";
const NOTE_AXIOS =
  "This file imports axios. If an axios error can reach this code, logging it whole writes the request's headers, " +
  "including Authorization, to your logs: check that your logger redacts them.";
const NOTE_ERROR_SENT =
  "The error (or its message) is still sent to the client: the fix only adds the log line. Consider sending a " +
  "generic message instead.";
const NOTE_NO_STATUS =
  "This code still answers 200 OK: the fix only adds the log line. Whether to send an error status such as 500 is " +
  "your decision, because it changes what clients receive.";
const NOTE_LOGS_EXPECTED =
  "The log line is at the start of the block, so it also logs failures that this code answers as expected (with a " +
  "4xx status).";

/** First characters of a line that would join it to the line before when there is no semicolon (ASI). */
const ASI_HAZARD = /^[([`+\-/]/;

/** Method names of a log call, as LP003 counts them (console.log, logger.error, ...). */
const LOG_METHODS = new Set(["log", "error", "warn", "info", "debug", "trace", "fatal"]);

/**
 * Proposed fixes for every LP003 finding in the file, by "line:column" of the finding. `readFile`
 * lets logger detection read one relative import (read-only); without it, only this file is used.
 */
export function proposeLp003Fixes(sourceFile: ts.SourceFile, readFile?: ReadFile): Map<string, Lp003Proposal> {
  const proposals = new Map<string, Lp003Proposal>();
  const targets = findLp003Targets(sourceFile);
  if (targets.length === 0) return proposals;
  const style = codeStyle(sourceFile);
  const axios = axiosNames(sourceFile);
  const logger = chooseLogger(sourceFile, readFile);
  for (const target of targets) {
    const { line, column } = reportedPosition(target.reported, sourceFile);
    proposals.set(`${line}:${column}`, propose(target, sourceFile, style, axios, logger));
  }
  return proposals;
}

function no(reason: string): Lp003Proposal {
  return { ok: false, reason };
}

function propose(
  target: Lp003Target & { analysis: { statuses: (number | "unknown")[] } },
  sourceFile: ts.SourceFile,
  style: CodeStyle,
  axios: Set<string>,
  logger: LoggerChoice,
): Lp003Proposal {
  const text = sourceFile.text;
  if (target.theCase === "E") return no(REASON_CLIENT_ERROR);

  const fn = target.handler.node as ts.FunctionLikeDeclaration;
  let block: ts.Block;
  if (target.catchClause !== undefined) {
    block = target.catchClause.block;
  } else if (fn.body !== undefined && ts.isBlock(fn.body)) {
    block = fn.body;
  } else {
    return no(REASON_EXPRESSION_BODY);
  }

  const requestParameter = fn.parameters[target.handler.kind === "error-middleware" ? 1 : 0]?.name;
  const requestName = requestParameter !== undefined && ts.isIdentifier(requestParameter) ? requestParameter.text : undefined;

  // The error's name: the catch's own variable, or a new one for `catch {}`.
  const edits: TextEdit[] = [];
  let errorName = target.errorName;
  const bindingAdded = target.catchClause !== undefined && target.catchClause.variableDeclaration === undefined;
  if (bindingAdded) {
    errorName = freeName(block, [requestName, target.handler.res, "console", logger.name]);
    const afterCatch = target.catchClause!.getStart(sourceFile) + "catch".length;
    edits.push({ start: afterCatch, end: afterCatch, newText: ` (${errorName})` });
  } else if (errorName === undefined) {
    return no(REASON_UNPACKED);
  }

  const notes: string[] = [];
  if (axios.size > 0) {
    const tryBlock = target.catchClause === undefined ? undefined : (target.catchClause.parent as ts.TryStatement).tryBlock;
    if (tryBlock !== undefined && callsThrough(tryBlock, axios)) return no(REASON_AXIOS);
    notes.push(NOTE_AXIOS);
  }

  // The log line must mean what it says: no local variable may hide the names it uses.
  const declared = declaredNames(block);
  for (const name of [requestName, bindingAdded ? undefined : errorName, "console", logger.name]) {
    if (name !== undefined && declared.has(name)) {
      return no(`No fix: this block declares its own variable named \`${name}\`, which the log line would use. Add the log line by hand.`);
    }
  }
  if (declaresAnywhere(sourceFile, "console")) return no("No fix: this file declares its own `console`, so LogPilot cannot be sure what console.error does here.");

  // Case C: the catch already logs a message with console, without the error. Add the error to that
  // call instead of writing a second log line.
  if (target.theCase === "C") {
    const appended = appendToConsoleCall(block, target.handler.res, errorName!, sourceFile);
    if (appended !== undefined) {
      edits.push(appended.edit);
      let description = `Add the caught error to the existing ${appended.call} call on line ${appended.line}.`;
      if (bindingAdded) description += ` The catch gets a variable for the error: catch (${errorName}).`;
      return {
        ok: true,
        edits,
        description,
        logger: {
          kind: "console",
          call: appended.call,
          confidence: "high",
          evidence: `this catch already logs with ${appended.call} on line ${appended.line}; the fix adds the error to that call`,
        },
        notes,
        safety: { errorName: errorName!, requestName, loggerName: "console" },
      };
    }
  }

  // Where: before the one statement that sends a 5xx response, else at the start of the block.
  const responseStatements = [
    ...new Set(serverErrorResponses(block, target.handler.res, target.helpers).map((call) => enclosingStatement(call, block))),
  ];
  const single = responseStatements.length === 1 ? responseStatements[0] : undefined;
  const beforeResponse = single !== undefined && isInBlock(single);
  const anchor = beforeResponse ? single : block.statements[0];
  if (anchor === undefined) return no("No fix: LogPilot could not find where to put the log line.");

  const anchorStart = anchor.getStart(sourceFile);
  let position = anchorStart;
  // Comments on their own lines above the statement belong to it: insert before them.
  for (const comment of ts.getLeadingCommentRanges(text, anchor.getFullStart()) ?? []) {
    if (/^[ \t]*$/.test(text.slice(text.lastIndexOf("\n", comment.pos - 1) + 1, comment.pos))) {
      position = comment.pos;
      break;
    }
  }

  const statement = logStatement(logger, errorName!, requestName, style.quote);
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  const indent = text.slice(lineStart, position);
  if (/^[ \t]*$/.test(indent) && lineStart > 0) {
    // On its own line, with the same indentation and line ending as the line it goes before.
    const eol = text[lineStart - 2] === "\r" ? "\r\n" : "\n";
    const semicolon = style.semicolons || ASI_HAZARD.test(text[anchorStart]) ? ";" : "";
    edits.push({ start: lineStart, end: lineStart, newText: indent + statement + semicolon + eol });
  } else {
    // The statement shares its line with other code (e.g. `catch (err) { res.status(500).end() }`).
    edits.push({ start: position, end: position, newText: `${statement}; ` });
  }

  const responseLine = sourceFile.getLineAndCharacterOfPosition(anchorStart).line + 1;
  const where = beforeResponse
    ? `just before the error response on line ${responseLine}`
    : target.catchClause === undefined
      ? "at the start of the error middleware"
      : "at the start of the catch block";
  let description = `Log the caught error with ${logger.name}.error ${where}.`;
  if (bindingAdded) description += ` The catch gets a variable for the error: catch (${errorName}).`;
  notes.push(...logger.notes);
  if (!beforeResponse && target.analysis.statuses.some((s) => s !== "unknown" && s >= 400 && s < 500)) notes.push(NOTE_LOGS_EXPECTED);
  if (target.theCase === "B") notes.push(NOTE_ERROR_SENT);
  if (target.theCase === "D") notes.push(NOTE_NO_STATUS);

  return {
    ok: true,
    edits,
    description,
    logger: { kind: logger.kind, call: `${logger.name}.error`, confidence: logger.confidence, evidence: logger.evidence },
    notes,
    safety: { errorName: errorName!, requestName, loggerName: logger.name, errorKey: logger.errorKey },
  };
}

/**
 * The log call, without a semicolon, in the logger's form (see loggers.ts for why each library
 * gets its form). Context is only the method and the route pattern; with an unpacked request
 * parameter there is none.
 */
function logStatement(logger: LoggerChoice, errorName: string, requestName: string | undefined, quote: string): string {
  const call = `${logger.name}.error`;
  const message = `${quote}Request failed${quote}`;
  const messageWithContext = requestName === undefined ? message : "`Request failed: ${" + requestName + ".method} ${" + requestName + ".route?.path}`";
  const context = requestName === undefined ? "" : `, method: ${requestName}.method, route: ${requestName}.route?.path`;
  const key = logger.errorKey ?? "err";
  const errorProperty = key === errorName ? errorName : `${key}: ${errorName}`;
  switch (logger.form) {
    case "console":
      return requestName === undefined
        ? `console.error(${quote}Request failed:${quote}, ${errorName})`
        : `console.error(${quote}Request failed:${quote}, { method: ${requestName}.method, route: ${requestName}.route?.path }, ${errorName})`;
    case "object-first":
      return `${call}({ ${errorProperty}${context} }, ${message})`;
    case "message-first":
      return `${call}(${messageWithContext}, ${errorName})`;
    case "message-object":
      return `${call}(${message}, { ${errorProperty}${context} })`;
    case "error-first":
      return `${call}(${errorName}, ${messageWithContext})`;
    case "error-only":
      return `${call}(${errorName})`;
  }
}

/**
 * Case C: the one log call in the block, when it is console.<method>(...) without the error, and
 * the edit that adds the error as its last argument. Undefined when there is not exactly one log
 * call, or it is not console's (another logger's argument order is not known).
 */
function appendToConsoleCall(
  block: ts.Block,
  res: string,
  errorName: string,
  sourceFile: ts.SourceFile,
): { edit: TextEdit; call: string; line: number } | undefined {
  const logCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && LOG_METHODS.has(node.expression.name.text)) {
      const receiver = node.expression.expression;
      if (!(ts.isIdentifier(receiver) && receiver.text === res)) logCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  if (logCalls.length !== 1) return undefined;
  const [call] = logCalls;
  const callee = call.expression as ts.PropertyAccessExpression;
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "console") return undefined;
  const args = call.arguments;
  const at = args.length === 0 ? args.pos : args[args.length - 1].getEnd();
  return {
    edit: { start: at, end: at, newText: args.length === 0 ? errorName : `, ${errorName}` },
    call: `console.${callee.name.text}`,
    line: sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line + 1,
  };
}

/** The nearest statement that contains `node`, inside `block`. */
function enclosingStatement(node: ts.Node, block: ts.Block): ts.Statement | undefined {
  for (let current = node.parent; current !== block && current !== undefined; current = current.parent) {
    if (current.kind >= ts.SyntaxKind.FirstStatement && current.kind <= ts.SyntaxKind.LastStatement) return current as ts.Statement;
  }
  return undefined;
}

/** True when a line can be inserted before `statement`: it sits in `{ }` or a switch case, not as an unbraced if/else branch. */
function isInBlock(statement: ts.Statement | undefined): statement is ts.Statement {
  const parent = statement?.parent;
  return parent !== undefined && (ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent));
}

/** The first of err, error, caughtError, caughtError2, ... that `block` does not mention at all. */
function freeName(block: ts.Block, reserved: (string | undefined)[]): string {
  const used = new Set<string>(reserved.filter((name): name is string => name !== undefined));
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) used.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(block);
  for (const name of ["err", "error", "caughtError"]) if (!used.has(name)) return name;
  for (let i = 2; ; i++) if (!used.has(`caughtError${i}`)) return `caughtError${i}`;
}

/** Names declared inside `block` (variables, functions, classes, parameters, catch variables). */
function declaredNames(block: ts.Block): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(element.name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) addBinding(node.name);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name !== undefined) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return names;
}

/** True when the file declares a variable, parameter, function, class or import with this name. */
function declaresAnywhere(sourceFile: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const declaredName =
      ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)
        ? node.name
        : undefined;
    if (declaredName !== undefined && ts.isIdentifier(declaredName) && declaredName.text === name) found = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Names bound to axios in this file: import axios from "axios", require("axios"), and axios.create(...) instances. */
function axiosNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const isRequireAxios = (expression: ts.Expression): boolean => {
    while (ts.isPropertyAccessExpression(expression)) expression = expression.expression; // require("axios").default
    return (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" &&
      expression.arguments.length === 1 &&
      ts.isStringLiteral(expression.arguments[0]) &&
      expression.arguments[0].text === "axios"
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "axios") {
      const clause = node.importClause;
      if (clause?.name) names.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const init = node.initializer;
      if (isRequireAxios(init)) names.add(node.name.text);
      // const api = axios.create({ ... })
      if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === "create") {
        const object = init.expression.expression;
        if (ts.isIdentifier(object) && names.has(object.text)) names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** True when `scope` calls a function through one of `names`: axios(...), axios.get(...), api.post(...). */
function callsThrough(scope: ts.Node, names: Set<string>): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      let callee: ts.Expression = node.expression;
      while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) callee = callee.expression;
      if (ts.isIdentifier(callee) && names.has(callee.text)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

/** How the file writes code: its quote character and whether its statements end with semicolons. */
interface CodeStyle {
  quote: "'" | '"';
  semicolons: boolean;
}

function codeStyle(sourceFile: ts.SourceFile): CodeStyle {
  let single = 0;
  let double = 0;
  let withSemicolon = 0;
  let without = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && !ts.isJsxAttribute(node.parent)) {
      const quote = sourceFile.text[node.getStart(sourceFile)];
      if (quote === "'") single++;
      else if (quote === '"') double++;
    }
    if (
      ts.isExpressionStatement(node) || ts.isVariableStatement(node) || ts.isReturnStatement(node) ||
      ts.isThrowStatement(node) || ts.isBreakStatement(node) || ts.isContinueStatement(node)
    ) {
      if (node.getText(sourceFile).endsWith(";")) withSemicolon++;
      else without++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { quote: single > double ? "'" : '"', semicolons: withSemicolon >= without };
}
