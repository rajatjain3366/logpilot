// Rule LP002 "lost-error-cause": finds catch blocks that throw a NEW error without
// attaching the error they caught as its `cause`.
//
//   catch (err) { throw new Error("Load failed"); }                  -> reported: err is dropped
//   catch (err) { throw new Error(`Load failed: ${err.message}`); }  -> reported: only its text survives
//   catch (err) { throw new Error("Load failed", err); }             -> reported: 2nd argument is options
//   catch (err) { throw new Error("Load failed", { cause: err }); }  -> fine
//   catch (err) { throw err; }                                        -> fine
//
// Only throws that leave the catch block directly are checked. A throw inside a callback or
// nested function runs at another time (or never), and a throw inside an inner `try { }` is
// handled by that try's own catch. The rule reads only the syntax tree (no type information),
// so it recognises the caught error by its variable name. See README "What LP002 will miss".

import ts from "typescript";
import type { Confidence, Finding, Severity } from "../types.js";
import { containsComment, findMentions, getCatchVariableName, getLines, isWrapper } from "./shared.js";

export const RULE_ID = "LP002";
export const RULE_NAME = "lost-error-cause";
/**
 * The version of this rule's behaviour, shown in JSON output. Increase it whenever a change makes
 * the rule report different findings or levels, so tools can tell results of old and new versions apart.
 */
export const RULE_VERSION = 1;

/** JavaScript's built-in error classes. Their 2nd argument is an options object: { cause }. */
const BUILT_IN_ERRORS = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError", "URIError"]);

/** Function or method names that look like logging: console.error, logger.warn, Sentry.captureException, ... */
const LOG_FUNCTIONS = new Set(["error", "warn", "info", "debug", "trace", "fatal", "log", "captureException"]);

/** Operators that turn the caught error into text or only test it: "x" + err, err instanceof X, err === y. */
const TEXT_OR_TEST_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** Argument text longer than this is shown as "..." in the suggestion's example. */
const MAX_EXAMPLE_LENGTH = 60;

/** The error object being thrown: `new SomeError(...)`, or a built-in `Error(...)` called without `new`. */
interface NewError {
  className: string; // as written: "Error", "DatabaseError", "errors.NotFound"
  args: readonly ts.Expression[];
  builtIn: boolean;
}

/** What the new error does with the caught one. "kept" means there is nothing to report. */
type Outcome = "kept" | "dropped" | "partial" | "options-mistake";

/** Things that make a finding less severe or less certain (cases A1-A4 in the README). */
interface Signals {
  logged: boolean; //     A1: the caught error is logged right before the throw
  commented: boolean; //  A2: a comment in the catch block may explain a deliberate choice
  noVariable: boolean; // A3: `catch {}` or `catch ({ message })`: no variable to attach
  underscore: boolean; // A3: `catch (_err)`: the name says "deliberately unused"
  guarded: boolean; //    A4: the throw sits under an if/switch that checks the caught error
}

/**
 * Runs LP002 on one parsed file and returns one finding per throw that loses the caught error.
 * `filePath` is only copied into the findings; this function never touches the disk.
 */
export function checkLostErrorCause(sourceFile: ts.SourceFile, filePath: string): Finding[] {
  const findings: Finding[] = [];

  function visit(node: ts.Node): void {
    if (ts.isThrowStatement(node)) {
      const catchClause = findEnclosingCatch(node);
      const newError = getNewError(node.expression, sourceFile);
      if (catchClause && newError) {
        const finding = checkThrow(node, newError, catchClause, sourceFile, filePath);
        if (finding) findings.push(finding);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

/**
 * The catch clause whose error this throw replaces, or undefined if the throw does not leave a
 * catch block directly. We walk up the tree from the throw, and the first thing we meet decides:
 *  - a catch clause: found it
 *  - a function or class: the throw runs at another time (a callback, a helper), so not this rule's business
 *  - a `try { }` block that has its own catch: that catch handles the throw
 */
function findEnclosingCatch(throwStatement: ts.ThrowStatement): ts.CatchClause | undefined {
  let child: ts.Node = throwStatement;
  let node: ts.Node = throwStatement.parent;
  while (!ts.isSourceFile(node)) {
    if (ts.isCatchClause(node)) return node;
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return undefined;
    if (ts.isTryStatement(node) && node.tryBlock === child && node.catchClause) return undefined;
    child = node;
    node = node.parent;
  }
  return undefined; // not inside any catch block
}

/** Describes the thrown value if it is a newly created error; undefined for `throw err`, `throw "text"`, `throw makeError()`. */
function getNewError(expression: ts.Expression, sourceFile: ts.SourceFile): NewError | undefined {
  const value = skipWrappers(expression);
  if (ts.isNewExpression(value)) {
    const className = value.expression.getText(sourceFile);
    return { className, args: value.arguments ?? [], builtIn: isBuiltInError(value.expression) };
  }
  // Error("x") without `new` also creates an error. For other functions we cannot know what they return.
  if (ts.isCallExpression(value) && isBuiltInError(value.expression)) {
    return { className: value.expression.getText(sourceFile), args: value.arguments, builtIn: true };
  }
  return undefined;
}

function isBuiltInError(callee: ts.Expression): boolean {
  return ts.isIdentifier(callee) && BUILT_IN_ERRORS.has(callee.text);
}

function checkThrow(
  throwStatement: ts.ThrowStatement,
  newError: NewError,
  catchClause: ts.CatchClause,
  sourceFile: ts.SourceFile,
  filePath: string,
): Finding | undefined {
  const name = getCatchVariableName(catchClause);
  // With no variable (`catch {}`), there is nothing the new error could have kept.
  const outcome: Outcome = name === undefined ? "dropped" : classify(newError, name);
  if (outcome === "kept") return undefined;

  const signals: Signals = {
    logged: name !== undefined && isLoggedBefore(throwStatement, catchClause, name),
    commented: containsComment(catchClause.block, sourceFile),
    noVariable: name === undefined,
    underscore: name !== undefined && name.startsWith("_"),
    guarded: name !== undefined && isGuarded(throwStatement, catchClause, name),
  };

  // Severity = how much evidence is lost, and how much evidence we have that it matters.
  // Confidence = how sure we are that losing it is a mistake.
  // Without a usable variable (A3), the replacement is often a deliberate translation into a
  // clearer error, so it is "worth reviewing" (medium), not high.
  let severity: Severity = outcome === "partial" || signals.noVariable || signals.underscore ? "medium" : "high";
  if (signals.logged || signals.guarded) severity = "low";
  const confidence: Confidence =
    signals.logged || signals.commented || signals.noVariable || signals.underscore || signals.guarded
      ? "medium"
      : "high";

  const start = sourceFile.getLineAndCharacterOfPosition(throwStatement.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(throwStatement.getEnd());
  const catchLine = sourceFile.getLineAndCharacterOfPosition(catchClause.getStart(sourceFile)).line + 1;

  return {
    ruleId: RULE_ID,
    ruleName: RULE_NAME,
    file: filePath,
    line: start.line + 1, // TypeScript counts from 0; people count from 1
    column: start.character + 1,
    severity,
    confidence,
    evidence: getLines(sourceFile, start.line, end.line),
    explanation: buildExplanation(outcome, name, newError, catchLine, signals),
    suggestion: buildSuggestion(newError, name, signals, sourceFile),
  };
}

/** Decides whether the new error keeps the caught error (`name`), and if not, how it loses it. */
function classify(newError: NewError, name: string): Outcome {
  const mentions = findMentions(newError.args, name);
  if (newError.builtIn) {
    // A built-in error keeps another error only through its options: new Error(msg, { cause: err }).
    // Anything in the 1st argument becomes the message, i.e. text.
    const options = newError.args[1];
    if (options !== undefined && isTheVariable(options, name)) return "options-mistake";
    if (options !== undefined && optionsMayHaveCause(options, name)) return "kept";
  } else if (mentions.some(passesWholeError)) {
    // Other classes may store it however they like: new AppError("msg", err), new AppError({ cause: err }).
    return "kept";
  }
  return mentions.length > 0 ? "partial" : "dropped";
}

/**
 * For built-in errors: could the 2nd argument attach the caught error as the cause?
 * `{ cause: err }`: yes. `{ cause: err.message }` or `{ foo: 1 }`: no. A variable such as
 * `options`, or a call, we cannot see into, so we assume yes rather than raise a false alarm.
 */
function optionsMayHaveCause(options: ts.Expression, name: string): boolean {
  const value = skipWrappers(options);
  if (!ts.isObjectLiteralExpression(value)) {
    const mentions = findMentions([value], name);
    return mentions.length === 0 || mentions.some(passesWholeError);
  }
  for (const property of value.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "cause") {
      return name === "cause"; // catch (cause) { throw new Error("x", { cause }); }
    }
    if (ts.isPropertyAssignment(property) && getPropertyName(property.name) === "cause") {
      return findMentions([property.initializer], name).some(passesWholeError);
    }
  }
  // No `cause` written out, but a spread (`{ ...options }`) might contain one.
  return value.properties.some((property) => ts.isSpreadAssignment(property));
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/**
 * True when this mention passes the whole error object along: f(err), { cause: err }, { err }, [err].
 * False when it only reads a part or makes text: err.message, `${err}`, "x" + err, String(err),
 * JSON.stringify(err); or only tests it: err instanceof X, err === y, typeof err, !err.
 */
function passesWholeError(mention: ts.Identifier): boolean {
  let node: ts.Node = mention;
  while (isWrapper(node.parent)) node = node.parent; // (err as Error).message is still err.message
  const parent = node.parent;

  if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node) {
    return false;
  }
  if (ts.isTemplateSpan(parent)) return false;
  if (ts.isBinaryExpression(parent) && TEXT_OR_TEST_OPERATORS.has(parent.operatorToken.kind)) return false;
  if (ts.isTypeOfExpression(parent) || ts.isPrefixUnaryExpression(parent)) return false;
  if (ts.isConditionalExpression(parent) && parent.condition === node) return false;
  if (ts.isCallExpression(parent) && isConversionToText(parent.expression)) return false;
  return true;
}

/** String(x) and JSON.stringify(x) turn an error into text (JSON.stringify of an Error is just "{}"). */
function isConversionToText(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return callee.text === "String";
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "JSON" &&
    callee.name.text === "stringify"
  );
}

/** True for `name` itself, also when wrapped: (err), err as Error, err! */
function isTheVariable(expression: ts.Expression, name: string): boolean {
  const value = skipWrappers(expression);
  return ts.isIdentifier(value) && value.text === name;
}

function skipWrappers(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (isWrapper(value)) value = value.expression;
  return value;
}

/**
 * A1: is the caught error logged (as a whole) by a statement that runs just before the throw?
 * We check the statements before the throw in its own block and in each enclosing block up to
 * the catch block. A log call tucked inside an `if` before the throw is not counted: it may not run.
 */
function isLoggedBefore(throwStatement: ts.ThrowStatement, catchClause: ts.CatchClause, name: string): boolean {
  let child: ts.Node = throwStatement;
  while (child !== catchClause.block) {
    const parent = child.parent;
    if (ts.isBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
      for (const statement of parent.statements) {
        if (statement === child) break;
        if (ts.isExpressionStatement(statement) && isLogCall(statement.expression, name)) return true;
      }
    }
    child = parent;
  }
  return false;
}

/** logger.error({ err }, "..."), console.error("...", err), Sentry.captureException(err), await log.warn(err) */
function isLogCall(expression: ts.Expression, name: string): boolean {
  const call = ts.isAwaitExpression(expression) ? expression.expression : expression;
  if (!ts.isCallExpression(call)) return false;
  const callee = call.expression;
  const functionName = ts.isPropertyAccessExpression(callee)
    ? callee.name.text
    : ts.isIdentifier(callee)
      ? callee.text
      : undefined;
  return (
    functionName !== undefined &&
    LOG_FUNCTIONS.has(functionName) &&
    findMentions(call.arguments, name).some(passesWholeError)
  );
}

/**
 * A4: is the throw inside an `if` or `switch` that checks the caught error?
 *   if (err.code === "ENOENT") throw new NotFoundError(path);
 *   switch (err.code) { case "E_EMPTY": throw new Error("Nothing to parse"); }
 */
function isGuarded(throwStatement: ts.ThrowStatement, catchClause: ts.CatchClause, name: string): boolean {
  for (let node: ts.Node = throwStatement.parent; node !== catchClause.block; node = node.parent) {
    if (ts.isIfStatement(node) && findMentions([node.expression], name).length > 0) return true;
    if (ts.isCaseBlock(node) && findMentions([node.parent.expression], name).length > 0) return true;
  }
  return false;
}

function buildExplanation(
  outcome: Outcome,
  name: string | undefined,
  newError: NewError,
  catchLine: number,
  signals: Signals,
): string {
  let text: string;
  if (name === undefined) {
    text =
      `This throw replaces the error caught on line ${catchLine} with a new error. The catch does not ` +
      "keep the whole caught error in a variable, so it cannot be attached: its message, stack trace " +
      "and properties such as `code` are discarded.";
  } else if (outcome === "options-mistake") {
    text =
      `This throw passes \`${name}\` (caught on line ${catchLine}) as the second argument of ` +
      `\`${newError.className}\`. That argument is an options object, so \`${name}\` does not become ` +
      "the cause and is lost, together with its message, stack trace and properties such as `code`.";
  } else if (outcome === "partial") {
    text =
      `This throw replaces \`${name}\` (caught on line ${catchLine}) with a new error that keeps only ` +
      "part of it, such as its message as text. Its stack trace, error type and properties such as " +
      "`code` are lost. Review whether those details could matter: attaching the cause keeps them at no cost.";
  } else {
    text =
      `This throw replaces \`${name}\` (caught on line ${catchLine}) with a new error without attaching ` +
      "it. Its message, stack trace and properties such as `code` are discarded, so whoever investigates " +
      "the new error cannot see what actually failed underneath.";
  }

  if (signals.guarded) {
    text += ` The surrounding condition checks \`${name}\`, so replacing it with a more specific error may be deliberate, but the original details are still dropped.`;
  }
  if (signals.logged) {
    text += ` \`${name}\` is logged above, so its details may be in your logs, but nothing links that log entry to the new error.`;
  }
  if (signals.underscore) {
    text += ` The leading underscore in \`${name}\` usually means the error is ignored on purpose, but its details are still lost.`;
  }
  if (signals.commented) {
    text += " A comment in this catch block may explain a deliberate choice, such as hiding internal details from API clients.";
  }
  if (signals.noVariable || signals.underscore) {
    text +=
      " This is often a deliberate translation into a clearer error, so review it: if the original " +
      "error could ever help an investigation, attach it as the cause.";
  }
  return text;
}

function buildSuggestion(
  newError: NewError,
  name: string | undefined,
  signals: Signals,
  sourceFile: ts.SourceFile,
): string {
  const cause = name ?? "err";
  const example = `throw new ${newError.className}(${exampleArguments(newError, cause, sourceFile)}, { cause: ${cause} })`;
  let text =
    `Attach the caught error as the cause: ${example}. Node's console.error and util.inspect print the ` +
    "whole cause chain, so the original message, stack trace and code stay available. The cause is not " +
    "included in JSON.stringify output or in error.stack, so on its own it does not expose internal " +
    "details to API clients; decide what clients see in your error handler.";
  if (!newError.builtIn) {
    text += ` If ${newError.className} does not accept an options argument yet, pass it on to Error: constructor(message, options) { super(message, options); }.`;
  }
  if (signals.logged) {
    text += " With the cause attached, you can often drop the separate log call and log the error once, where it is finally handled.";
  }
  if (name === undefined) {
    text += " Write `catch (err)` so the caught error is available to pass on.";
  }
  return text;
}

/** The new error's own arguments, reused so the example matches the code. The caught error itself is left out. */
function exampleArguments(newError: NewError, name: string, sourceFile: ts.SourceFile): string {
  // For built-in errors only the message is kept: the 2nd argument becomes { cause }.
  const args = newError.builtIn ? newError.args.slice(0, 1) : newError.args;
  const text = args
    .filter((arg) => !isTheVariable(arg, name))
    .map((arg) => arg.getText(sourceFile))
    .join(", ");
  return text === "" || text.includes("\n") || text.length > MAX_EXAMPLE_LENGTH ? '"..."' : text;
}
