// Rule LP001 "empty-catch": finds catch blocks that silently swallow errors.
//
// A catch block is reported when it contains no real statements.
//
// Severity comes from evidence about the code, decided by the first of these that applies:
//   1. the try calls a test assertion that fails by throwing (expect.fail(), assert(false), ...):
//      the empty catch also swallows that test failure    -> severity high, confidence high
//   2. it sits inside another catch block whose error is still passed on (best-effort work
//      while handling that error)                         -> severity low
//   3. positive evidence that the swallowed error matters: an existence check before the risky
//      code rules out the expected failure ("it isn't there"), so only unexpected errors can
//      reach this catch                                   -> severity high
//   4. otherwise: worth reviewing                         -> severity medium
//
// Confidence is high, except that a comment explaining the ignore (inside the catch, inside the
// try, on the line(s) directly above the try, or right after the catch's `}`) lowers it to medium
// in cases 2-4. Since Milestone 2.5 a comment no longer lowers SEVERITY: round 2 found real bugs
// next to comments such as "should throw". A comment shows intent, not harmlessness. Comments that
// instruct a tool (eslint-disable, @ts-ignore, istanbul ignore, ...) are not explanations at all.
//
// Any catch block with at least one statement (a log call, a rethrow, a `return`,
// anything) is NOT reported by this rule.

import ts from "typescript";
import type { Confidence, Finding, Severity } from "../types.js";
import { findComments, findMentions, getCatchVariableName, getLines, isPropertyName, isWrapper } from "./shared.js";

export const RULE_ID = "LP001";
export const RULE_NAME = "empty-catch";
/**
 * The version of this rule's behaviour, shown in JSON output. Increase it whenever a change makes
 * the rule report different findings or levels, so tools can tell results of old and new versions apart.
 */
export const RULE_VERSION = 2; // 2 (Milestone 2.5): comments lower confidence only; tool directives; more assertions

/**
 * Test assertions that always fail by throwing, whatever their arguments. An empty catch around
 * them swallows that failure, so the test can never fail there.
 */
const ALWAYS_FAILING_CALLS = new Set([
  "expect.unreachable", // Vitest
  "expect.fail", //        Vitest, Chai's expect interface
  "assert.fail", //        node:assert, Chai's assert interface
  "chai.expect.fail",
  "chai.assert.fail",
]);

/** Assertions that fail by throwing when their first argument is the literal `false`: assert(false). */
const FALSE_ASSERTIONS = new Set(["assert", "assert.ok"]);

/**
 * t.fail(), t.ok(false), test.fail(), test.ok(false). In tap, tape and AVA, `t` is the test context
 * passed to the test function: tap's assertions do not throw, and AVA documents that catching a
 * failed assertion does not make the test pass. So an empty catch hides nothing there, and these
 * count only when `t` or `test` is NOT a parameter of an enclosing function, for example
 * `import { assert as test } from "./shared"`: then it is an assertion library, which throws.
 */
const TEST_OBJECT_NAMES = new Set(["t", "test"]);

/**
 * Comments that instruct a tool rather than explain the code: linters (ESLint, Biome), the
 * TypeScript compiler, coverage tools (istanbul, c8, v8), Prettier, and LogPilot's own
 * suppressions. They do not count as explanations, even with a description after them, because
 * that description explains the instruction, not why the error may be ignored.
 */
const TOOL_DIRECTIVE =
  /^(?:eslint-[a-z-]+|@ts-(?:ignore|expect-error|nocheck)|(?:istanbul|c8|v8)\s+ignore|prettier-ignore|biome-ignore|logpilot-ignore)\b/;

/** Functions that check that something exists: existsSync(p), pathExists(p), fileExists(p), ... */
const EXISTS_FUNCTION = /exists?(Sync)?$/i;

/** Methods that check that something is there: map.has(key), obj.hasOwnProperty(key), stats.isFile(). */
const EXISTS_METHODS = new Set(["has", "hasOwnProperty", "isFile", "isDirectory"]);

const EXPLANATION_EMPTY =
  "This catch block is empty. If the code in the try block fails, the error is discarded and " +
  "nothing records it. That can be deliberate, for example for an optional step or an expected " +
  "failure, so review it: if a failure here could ever need investigating, it would leave no trace.";

/** Added to the comment explanations: why a comment lowers only the confidence. */
const COMMENT_IS_INTENT =
  " A comment shows that the ignore is intended, not that every possible failure here is harmless, " +
  "so review everything the try block can throw.";

const EXPLANATION_COMMENT_ONLY =
  "This catch block contains only a comment. The comment suggests that ignoring the error " +
  "may be deliberate, but the error is still silently discarded: nothing is logged, rethrown, " +
  "or returned, so a failure here leaves no trace in production." +
  COMMENT_IS_INTENT;

const EXPLANATION_COMMENT_NEARBY =
  "This catch block is empty, and a comment next to it (in or right above the try block, or " +
  "right after the catch) suggests that ignoring the error is deliberate. The error is still " +
  "discarded: if the code ever fails for a reason the comment did not expect, there will be no trace of it." +
  COMMENT_IS_INTENT;

/** The catch block around this one, whose own error is still passed on (rule 2). */
interface OuterError {
  name: string; // its variable, e.g. "e"
  line: number; // line of its `catch`
}

/**
 * Runs LP001 on one parsed file and returns one finding per empty catch block.
 * `filePath` is only copied into the findings; this function never touches the disk.
 */
export function checkEmptyCatch(sourceFile: ts.SourceFile, filePath: string): Finding[] {
  const findings: Finding[] = [];

  // Visitor: look at this node, then visit all of its children (depth-first).
  function visit(node: ts.Node): void {
    if (ts.isCatchClause(node) && isEmptyBlock(node.block)) {
      findings.push(createFinding(node, sourceFile, filePath));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

/** True when a block has no real statements. A stray `;` (an "empty statement") counts as nothing. */
function isEmptyBlock(block: ts.Block): boolean {
  return block.statements.every((statement) => ts.isEmptyStatement(statement));
}

function createFinding(catchClause: ts.CatchClause, sourceFile: ts.SourceFile, filePath: string): Finding {
  const tryStatement = catchClause.parent; // a catch clause always belongs to a try statement
  // getStart() skips leading whitespace/comments, so this is the position of the `catch` keyword.
  const start = sourceFile.getLineAndCharacterOfPosition(catchClause.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(catchClause.getEnd());

  let severity: Severity = "medium"; // the default: worth reviewing
  let confidence: Confidence = "high";
  let explanation = EXPLANATION_EMPTY;
  let suggestion = buildSuggestion(catchClause);

  const testFailureCall = findTestFailureCall(tryStatement.tryBlock);
  if (testFailureCall !== undefined) {
    // A swallowed test assertion wins over everything else: a real bug in a test, comment or not.
    severity = "high";
    explanation =
      `This catch block is empty, and its try block calls ${testFailureCall}, which fails the test by ` +
      "throwing an error. The empty catch swallows that failure too, so this check can never fail.";
    suggestion =
      "Let the failure through and check the expected error instead of ignoring it: for example " +
      "await expect(promise).rejects.toThrow(...) or expect(() => run()).toThrow(...) in Vitest or " +
      "Jest, or inspect the caught error inside the catch block.";
  } else {
    // A comment explains the ignore: LogPilot is less sure the finding is a real problem, but the
    // error is lost all the same, so the severity is left to the evidence below.
    const commentInCatch = findComments(catchClause.block, sourceFile).some((c) => isExplanation(c, sourceFile));
    const commentNearby =
      hasCommentEndingItsLine(tryStatement.tryBlock, sourceFile) ||
      hasCommentDirectlyAbove(tryStatement, sourceFile) ||
      hasCommentRightAfter(catchClause, sourceFile);
    const commented = commentInCatch || commentNearby;
    if (commented) {
      confidence = "medium";
      explanation = commentInCatch ? EXPLANATION_COMMENT_ONLY : EXPLANATION_COMMENT_NEARBY;
    }

    // Best-effort work while another error, which is still passed on, is being handled.
    const outerError = findOuterErrorStillPassedOn(tryStatement, sourceFile);
    if (outerError !== undefined) {
      severity = "low";
      explanation =
        `This catch block is empty, but it runs while another error (\`${outerError.name}\`, caught on ` +
        `line ${outerError.line}) is being handled, and that error is still passed on. Only the details ` +
        "of this secondary failure are lost, so the main evidence survives.";
      suggestion = buildSecondaryFailureSuggestion(catchClause, outerError);
    }

    // Positive evidence that the swallowed error matters (unless an outer error is passed on).
    const guard = outerError !== undefined ? undefined : findExistenceGuard(tryStatement);
    if (guard !== undefined) {
      const guardLine = sourceFile.getLineAndCharacterOfPosition(guard.getStart(sourceFile)).line + 1;
      severity = "high";
      explanation =
        `This catch block is empty, and the check on line ${guardLine} already rules out the expected ` +
        "failure (the thing not being there). So only unexpected errors can reach this catch, such as " +
        "a corrupt file, missing permissions or a bug, and they are discarded without a trace while " +
        "the code carries on as if nothing happened.";
      if (commented) {
        explanation +=
          " A comment next to it suggests the ignore is deliberate; check that it also covers these unexpected failures.";
      }
    }
  }

  return {
    ruleId: RULE_ID,
    ruleName: RULE_NAME,
    file: filePath,
    line: start.line + 1, // TypeScript counts lines and columns from 0; people count from 1
    column: start.character + 1,
    severity,
    confidence,
    evidence: getLines(sourceFile, start.line, end.line),
    explanation,
    suggestion,
  };
}

/**
 * Case 1: the first test assertion in the try block that fails by throwing, as shown in the
 * explanation ("expect.fail()", "assert(false)"). Calls inside nested functions are skipped:
 * they run at another time, not inside this try.
 */
function findTestFailureCall(tryBlock: ts.Block): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node)) {
      found = testFailure(node);
      if (found !== undefined) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(tryBlock);
  return found;
}

/** "expect.fail()" or "assert(false)" when this call fails the test by throwing; otherwise undefined. */
function testFailure(call: ts.CallExpression): string | undefined {
  const name = dottedName(call.expression);
  if (name === undefined) return undefined;
  const firstIsFalse = call.arguments[0]?.kind === ts.SyntaxKind.FalseKeyword;

  if (ALWAYS_FAILING_CALLS.has(name)) return `${name}()`;
  if (FALSE_ASSERTIONS.has(name)) return firstIsFalse ? `${name}(false)` : undefined;

  const [object, method, ...more] = name.split(".");
  if (more.length > 0 || !TEST_OBJECT_NAMES.has(object) || isParameterName(call, object)) return undefined;
  if (method === "fail") return `${name}()`;
  if (method === "ok" && firstIsFalse) return `${name}(false)`;
  return undefined;
}

/** "a.b.c" for a callee made only of names (`a`, `a.b`, `a.b.c`); undefined for anything else. */
function dottedName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const object = dottedName(expression.expression);
    return object === undefined ? undefined : `${object}.${expression.name.text}`;
  }
  return undefined;
}

/** True when `name` is a parameter of a function around `node`, like `t` in `test("x", (t) => ...)`. */
function isParameterName(node: ts.Node, name: string): boolean {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (ts.isFunctionLike(current) && current.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) {
      return true;
    }
  }
  return false;
}

/**
 * Positive evidence: before the risky code runs, the code checks that the thing it works on
 * exists, so the expected failure ("it isn't there") is ruled out and this catch can only
 * swallow UNEXPECTED errors. Three shapes count, where exists(x) is an existence check on a
 * variable x that the guarded code also uses:
 *   if (exists(x)) { try { use(x) } catch {} }        (an `if` around the try, same function)
 *   try { if (exists(x)) { use(x) } } catch {}        (or: try { if (!exists(x)) return; use(x) })
 *   if (!exists(x)) return;  try { use(x) } catch {}  (an early exit before the try, same block)
 * Returns the `if` statement that does the check.
 */
function findExistenceGuard(tryStatement: ts.TryStatement): ts.IfStatement | undefined {
  const tryBlock = tryStatement.tryBlock;
  const [first, ...rest] = tryBlock.statements;

  // The check is the first statement inside the try.
  if (first !== undefined && ts.isIfStatement(first)) {
    if (usesAny([first.thenStatement], checkedNames(first.expression))) return first;
    if (usesAny(rest, earlyExitNames(first))) return first;
  }

  // An early exit before the try, in the same block.
  const parent = tryStatement.parent;
  if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
    for (const statement of parent.statements) {
      if (statement === tryStatement) break;
      if (ts.isIfStatement(statement) && usesAny([tryBlock], earlyExitNames(statement))) return statement;
    }
  }

  // An `if` around the try: the try must be in its "then" branch, not in the `else`.
  let child: ts.Node = tryStatement;
  for (let node: ts.Node = tryStatement.parent; !ts.isSourceFile(node); child = node, node = node.parent) {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) break; // the check would run at another time
    if (ts.isIfStatement(node) && node.thenStatement === child && usesAny([tryBlock], checkedNames(node.expression))) {
      return node;
    }
  }
  return undefined;
}

/**
 * The variables that existence checks in `condition` look at: existsSync(p) gives p,
 * map.has(k) gives map and k, stat(p).isFile() gives p, `k in obj` gives k and obj.
 * Negated checks (`!existsSync(p)`) mean "it is NOT there" and are skipped, and so are
 * comparisons such as `existsSync(p) === false`.
 */
function checkedNames(condition: ts.Expression): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) return;
    if (ts.isBinaryExpression(node) && isEqualityOperator(node.operatorToken.kind)) return;
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (EXISTS_FUNCTION.test(name) || name === "hasOwn") {
        names.push(...variableNames(node.arguments)); // existsSync(p), Object.hasOwn(obj, key)
      } else if (EXISTS_METHODS.has(name) && ts.isPropertyAccessExpression(callee)) {
        names.push(...variableNames([callee.expression, ...node.arguments])); // map.has(k), stat(p).isFile()
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword) {
      names.push(...variableNames([node.left, node.right])); // "key" in obj
    }
    ts.forEachChild(node, visit);
  };
  visit(condition);
  return names;
}

/** `if (!exists(x)) return;` (or continue, break, throw; with no else) gives the names checked: x. */
function earlyExitNames(statement: ts.IfStatement): string[] {
  if (statement.elseStatement !== undefined || !isExit(statement.thenStatement)) return [];
  let condition = statement.expression;
  while (ts.isParenthesizedExpression(condition)) condition = condition.expression;
  if (!ts.isPrefixUnaryExpression(condition) || condition.operator !== ts.SyntaxKind.ExclamationToken) return [];
  return checkedNames(condition.operand);
}

/** return, continue, break or throw: alone, or as the only statement of a block. */
function isExit(statement: ts.Statement): boolean {
  const only = ts.isBlock(statement) && statement.statements.length === 1 ? statement.statements[0] : statement;
  return ts.isReturnStatement(only) || ts.isContinueStatement(only) || ts.isBreakStatement(only) || ts.isThrowStatement(only);
}

function isEqualityOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsEqualsToken ||
    kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsToken ||
    kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
  );
}

/** Names of the variables used in `nodes`: not property names (the `b` in `a.b`), not called functions. */
function variableNames(nodes: readonly ts.Node[]): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    const isCallee = ts.isCallExpression(node.parent) && node.parent.expression === node;
    if (ts.isIdentifier(node) && !isPropertyName(node) && !isCallee) names.push(node.text);
    ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return names;
}

/** True when any of `names` is used as a variable inside `nodes`: the check is about the same thing. */
function usesAny(nodes: readonly ts.Node[], names: string[]): boolean {
  return names.some((name) => findMentions(nodes, name).length > 0);
}

/**
 * True for a comment that can explain the code; false for a tool directive such as
 * `// eslint-disable-next-line no-empty` or `/* istanbul ignore next *\/`. The directive must
 * start the comment, so "see why eslint-disable is not needed" still counts as an explanation.
 */
function isExplanation(comment: ts.TextRange, sourceFile: ts.SourceFile): boolean {
  const raw = sourceFile.text.slice(comment.pos, comment.end);
  const body = raw.startsWith("//") ? raw.slice(2) : raw.slice(2, raw.endsWith("*/") ? -2 : undefined);
  return !TOOL_DIRECTIVE.test(body.replace(/^[\s*]+/, "")); // also skip the extra `*` of `/** ... */`
}

/**
 * Comment case, inside the try: an explaining comment with nothing but spaces after it on its line.
 * Comments embedded in the middle of code, such as `f(/* #__PURE__ *\/ x)`, are annotations
 * for other tools, not explanations, so they do not count.
 */
function hasCommentEndingItsLine(tryBlock: ts.Block, sourceFile: ts.SourceFile): boolean {
  const text = sourceFile.text;
  return findComments(tryBlock, sourceFile).some((comment) => {
    if (!isExplanation(comment, sourceFile)) return false;
    for (let i = comment.end; i < text.length; i++) {
      if (text[i] === "\n" || text[i] === "\r") return true;
      if (text[i] !== " " && text[i] !== "\t") return false;
    }
    return true; // the comment is at the very end of the file
  });
}

/**
 * Comment case, above the try: an explaining comment in the block of comment lines that ends on
 * the line directly above the `try` keyword. Tool directives in that block are skipped, so
 * "// the cache is optional" followed by "// eslint-disable-next-line no-empty" still counts.
 */
function hasCommentDirectlyAbove(tryStatement: ts.TryStatement, sourceFile: ts.SourceFile): boolean {
  // Comments between the previous code and `try`. A comment at the end of the previous code line
  // belongs to that code, so TypeScript does not include it here.
  const comments = ts.getLeadingCommentRanges(sourceFile.text, tryStatement.pos) ?? [];
  const lineOf = (position: number) => sourceFile.getLineAndCharacterOfPosition(position).line;
  let reach = lineOf(tryStatement.getStart(sourceFile)); // the next comment up must end on reach - 1 or later
  for (let i = comments.length - 1; i >= 0; i--) {
    if (lineOf(comments[i].end) < reach - 1) return false; // a blank line or code in between
    if (isExplanation(comments[i], sourceFile)) return true;
    reach = lineOf(comments[i].pos);
  }
  return false;
}

/** Comment case, after the catch: `} catch {} // reason` on the same line. */
function hasCommentRightAfter(catchClause: ts.CatchClause, sourceFile: ts.SourceFile): boolean {
  return (ts.getTrailingCommentRanges(sourceFile.text, catchClause.end) ?? []).some((c) => isExplanation(c, sourceFile));
}

/**
 * Rule 2: is this try/catch part of handling ANOTHER error that is still passed on?
 * We walk up from the try statement to the nearest catch block around it, staying in the same
 * function. If that catch still throws, returns or hands on its own error, the main evidence
 * survives, and this empty catch only loses a secondary failure.
 */
function findOuterErrorStillPassedOn(tryStatement: ts.TryStatement, sourceFile: ts.SourceFile): OuterError | undefined {
  for (let node: ts.Node = tryStatement.parent; !ts.isSourceFile(node); node = node.parent) {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return undefined; // runs at another time
    if (ts.isCatchClause(node)) {
      const name = getCatchVariableName(node);
      if (name === undefined || !findMentions([node.block], name).some(isPassedOn)) return undefined;
      return { name, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1 };
    }
  }
  return undefined;
}

/** throw e, return e, f(e), new X(e), { cause: e }, { e }, [e]: the whole error goes somewhere. */
function isPassedOn(mention: ts.Identifier): boolean {
  let node: ts.Node = mention;
  while (isWrapper(node.parent)) node = node.parent; // (e as Error) is still e
  const parent = node.parent;
  if (ts.isThrowStatement(parent) || ts.isReturnStatement(parent)) return true;
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    return parent.arguments?.some((argument) => argument === node) ?? false;
  }
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node;
  return ts.isShorthandPropertyAssignment(parent) || ts.isArrayLiteralExpression(parent);
}

/**
 * The fix suggestion, using the catch's real variable name (e.g. `parseError`) in the examples.
 * If the catch has no variable (`catch {}`) or destructures the error (`catch ({ message })`),
 * the examples use `err` and we add a hint to write `catch (err)`.
 */
function buildSuggestion(catchClause: ts.CatchClause): string {
  const variableName = getCatchVariableName(catchClause);
  const name = variableName ?? "err";

  let suggestion =
    "Handle the error explicitly: log it with your project's logger " +
    `(e.g. logger.error(${logArgument(name)}, "failed to load config")), rethrow it with context ` +
    `(throw new Error("Failed to load config", { cause: ${name} })), or return a deliberate ` +
    "fallback value. When logging, include the error and safe context such as the operation " +
    "name or record IDs, never passwords, tokens, or full request bodies.";
  if (variableName === undefined) {
    suggestion += " This catch does not keep the error in a variable; write `catch (err)` so the error is available to handle.";
  }
  return suggestion;
}

/** Rule 2's suggestion: keep the main error; optionally leave a quiet trace of the secondary one. */
function buildSecondaryFailureSuggestion(catchClause: ts.CatchClause, outerError: OuterError): string {
  const variableName = getCatchVariableName(catchClause);
  let suggestion =
    `Usually no change is needed, as long as \`${outerError.name}\` keeps being passed on. If this secondary ` +
    "failure could matter, record it at debug level instead of dropping it, e.g. " +
    `logger.debug(${logArgument(variableName ?? "err")}, "could not add details to the error").`;
  if (variableName === undefined) {
    suggestion += " This catch does not keep the error in a variable; write `catch (err)` to log it.";
  }
  return suggestion;
}

/** Loggers like pino only format an error nicely under the key "err", hence { err: parseError }. */
function logArgument(name: string): string {
  return name === "err" ? "{ err }" : `{ err: ${name} }`;
}
