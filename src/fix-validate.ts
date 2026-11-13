// Fix validation: checks a proposed fix in memory before LogPilot shows it. A fix that fails any
// check is not shown, and the reason is reported instead. Nothing here reads or writes files.
//
// The checks, in order:
//   1. The fix only INSERTS text: nothing in the file is removed or changed.
//   2. The file had no syntax errors, and the fixed text still parses without any.
//   3. The inserted code uses only safe names: the caught error, req.method, req.route?.path and
//      the logger. Never the request body, headers, query string, cookies, URL or anything else.
//   4. Running every rule (and the suppression comments) on the fixed text gives exactly the same
//      results as before, minus the finding being fixed: it is gone, and nothing new appears.

import ts from "typescript";
import { checkSourceFile, findSyntaxErrors, parseSource } from "./analyze.js";
import { applyEdits, isInsertOnly, sortedEdits } from "./fix-edits.js";
import type { Finding, FixSafety, TextEdit } from "./types.js";

/** The names a fix's inserted code may use (defined in types.ts; re-exported for the fixer). */
export type { FixSafety };

/** The only request properties a fix may read: req.method and req.route?.path (the route pattern). */
const REQUEST_PROPERTIES = new Set(["method", "route"]);
/** The only keys of the context object a fix may write. */
const CONTEXT_KEYS = new Set(["err", "method", "route"]);
/** The only logger methods a fix may call. */
const LOGGER_METHODS = new Set(["error"]);

/**
 * Words that must never appear in inserted code, as a second line of defence after the name
 * check: request parts that can hold secrets or personal data (see README "Fix previews").
 * (req.log is blocked by the name check: `log` is not an allowed request property. The word itself
 * is allowed, because `log` is a common name for a bunyan logger.)
 */
const FORBIDDEN_WORDS =
  /\b(body|headers?|query|cookies|signedCookies|originalUrl|url|baseUrl|params|ip|ips|user|session|hostname)\b|\.get\(/;

/**
 * Checks a fix for `finding` in the file `fileName` (whose text is `text`). Returns undefined when
 * the fix may be shown, or the reason it may not.
 */
export function validateFix(
  fileName: string,
  displayPath: string,
  text: string,
  finding: Finding,
  edits: TextEdit[],
  safety: FixSafety,
): string | undefined {
  return validateFixSet(fileName, displayPath, text, [{ finding, edits, safety }]);
}

/** One fix of a set: the finding it fixes, its edits, and the names its inserted code may use. */
export interface FixToCheck {
  finding: Finding;
  edits: TextEdit[];
  safety: FixSafety;
}

/**
 * Checks several fixes for one file TOGETHER (`logpilot fix` writes all the fixes accepted for a
 * file at once): the same checks as validateFix, on the text with every fix applied. Every fixed
 * finding must be gone, and nothing else may change. Returns undefined, or the reason.
 */
export function validateFixSet(fileName: string, displayPath: string, text: string, fixes: FixToCheck[]): string | undefined {
  const edits = fixes.flatMap((fix) => fix.edits);
  if (!isInsertOnly(edits)) return "the fix would remove or change existing code (LogPilot's fixes only insert text)";
  let patched: string;
  try {
    patched = applyEdits(text, edits);
  } catch (error) {
    return `the fix's edits are invalid: ${(error as Error).message}`;
  }

  const original = parseSource(fileName, text);
  if (findSyntaxErrors(original).length > 0) return "the file has syntax errors, so LogPilot cannot check a fix";
  const fixed = parseSource(fileName, patched);
  const errors = findSyntaxErrors(fixed);
  if (errors.length > 0) {
    return `the fixed code would not parse (${ts.flattenDiagnosticMessageText(errors[0].messageText, " ")})`;
  }

  // Each fix's inserted code is checked against that fix's own safe names.
  const ranges = insertedRanges(edits);
  for (const fix of fixes) {
    const unsafe = unsafeCode(fixed, fix.edits.map((edit) => ranges.get(edit) as ts.TextRange), fix.safety);
    if (unsafe !== undefined) return unsafe;
  }

  return changedResults(original, fixed, displayPath, fixes.map((fix) => fix.finding), edits);
}

/** Where each edit's inserted text is in the FIXED text (all edits applied). */
function insertedRanges(edits: TextEdit[]): Map<TextEdit, ts.TextRange> {
  let shift = 0;
  const ranges = new Map<TextEdit, ts.TextRange>();
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    ranges.set(edit, { pos: edit.start + shift, end: edit.start + shift + edit.newText.length });
    shift += edit.newText.length - (edit.end - edit.start);
  }
  return ranges;
}

/** Why the inserted code is unsafe, or undefined. */
function unsafeCode(fixed: ts.SourceFile, ranges: ts.TextRange[], safety: FixSafety): string | undefined {
  for (const range of ranges) {
    const inserted = fixed.text.slice(range.pos, range.end);
    const word = FORBIDDEN_WORDS.exec(stripStrings(inserted));
    if (word !== null) return `the fix's code would use "${word[0]}", which LogPilot never logs`;
  }

  const inside = (node: ts.Node) => ranges.some((r) => node.getStart(fixed) < r.end && node.getEnd() > r.pos);
  const values = new Set([safety.errorName, safety.loggerName, ...(safety.requestName === undefined ? [] : [safety.requestName])]);
  let problem: string | undefined;
  const visit = (node: ts.Node): void => {
    if (problem !== undefined) return;
    if (inside(node)) {
      if (ts.isElementAccessExpression(node)) problem = `the fix's code would use ${node.getText(fixed)}`;
      if (ts.isIdentifier(node)) problem = identifierProblem(node, fixed, values, safety);
    }
    ts.forEachChild(node, visit);
  };
  visit(fixed);
  return problem;
}

/** Why one identifier in inserted code is not allowed, or undefined. */
function identifierProblem(identifier: ts.Identifier, fixed: ts.SourceFile, values: Set<string>, safety: FixSafety): string | undefined {
  const parent = identifier.parent;
  const name = identifier.text;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    // A property: req.method, req.route, req.route.path, logger.error. Nothing else.
    const object = parent.expression;
    const allowed =
      (ts.isIdentifier(object) && object.text === safety.requestName && REQUEST_PROPERTIES.has(name)) ||
      (ts.isPropertyAccessExpression(object) &&
        ts.isIdentifier(object.expression) &&
        object.expression.text === safety.requestName &&
        object.name.text === "route" &&
        name === "path") ||
      (ts.isIdentifier(object) && object.text === safety.loggerName && LOGGER_METHODS.has(name));
    return allowed ? undefined : `the fix's code would use ${parent.getText(fixed)}`;
  }
  const keyAllowed = CONTEXT_KEYS.has(name) || name === safety.errorKey;
  if (ts.isPropertyAssignment(parent) && parent.name === identifier) {
    return keyAllowed ? undefined : `the fix's code would log a field named "${name}"`;
  }
  if (ts.isShorthandPropertyAssignment(parent)) {
    return name === safety.errorName && keyAllowed ? undefined : `the fix's code would log "${name}"`;
  }
  if (ts.isVariableDeclaration(parent) && ts.isCatchClause(parent.parent)) {
    return name === safety.errorName ? undefined : `the fix would name the caught error "${name}"`;
  }
  return values.has(name) ? undefined : `the fix's code would use "${name}"`;
}

/** The text with the contents of string literals blanked out (the log message may say anything harmless). */
function stripStrings(code: string): string {
  return code.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (s) => s[0] + " ".repeat(s.length - 2) + s[0]);
}

/**
 * Compares every rule's results (and the suppressions) before and after the fixes. Returns
 * undefined when the only difference is that the fixed `findings` are gone, or what else changed.
 */
function changedResults(
  original: ts.SourceFile,
  fixed: ts.SourceFile,
  displayPath: string,
  findings: Finding[],
  edits: TextEdit[],
): string | undefined {
  const sorted = sortedEdits(original.text, edits);
  // Where a line of the original file is in the fixed file (inserted text pushes it down).
  const moved = (line: number, column: number) => {
    const offset = original.getPositionOfLineAndCharacter(line - 1, column - 1);
    const shift = sorted.filter((e) => e.start <= offset).reduce((sum, e) => sum + e.newText.length - (e.end - e.start), 0);
    const position = fixed.getLineAndCharacterOfPosition(offset + shift);
    return { line: position.line + 1, column: position.character + 1 };
  };
  const key = (f: Finding) => `${f.ruleId} at line ${f.line}:${f.column} (${f.severity}/${f.confidence})`;
  const movedKey = (f: Finding) => key({ ...f, ...moved(f.line, f.column) });

  const before = checkSourceFile(original, displayPath);
  const after = checkSourceFile(fixed, displayPath);
  const isFixed = (f: Finding) => findings.some((g) => g.ruleId === f.ruleId && g.line === f.line && g.column === f.column);
  const expected = before.kept.filter((f) => !isFixed(f)).map(movedKey);
  const actual = after.kept.map(key);

  for (const finding of findings) {
    if (actual.includes(movedKey(finding))) return `${finding.ruleId} still reports this code after the fix`;
  }
  const extra = difference(actual, expected);
  if (extra.length > 0) return `the fix would make LogPilot report something new: ${extra[0]}`;
  const missing = difference(expected, actual);
  if (missing.length > 0) return `the fix would change another finding: ${missing[0]}`;

  const suppressedBefore = before.suppressed.map((s) => movedKey(s.finding));
  const suppressedAfter = after.suppressed.map((s) => key(s.finding));
  if (difference(suppressedBefore, suppressedAfter).length + difference(suppressedAfter, suppressedBefore).length > 0) {
    return "the fix would change which findings a logpilot-ignore comment hides";
  }
  const warningKey = (type: string, line: number | undefined) => `${type}:${line ?? 0}`;
  const warningsBefore = before.warnings.map((w) => warningKey(w.type, w.line === undefined ? undefined : moved(w.line, 1).line));
  const warningsAfter = after.warnings.map((w) => warningKey(w.type, w.line));
  if (difference(warningsAfter, warningsBefore).length > 0) return "the fix would cause a new warning about a logpilot-ignore comment";
  return undefined;
}

/** The items of `a` that are not in `b`, counting duplicates (multiset difference). */
function difference(a: string[], b: string[]): string[] {
  const rest = [...b];
  return a.filter((item) => {
    const index = rest.indexOf(item);
    if (index === -1) return true;
    rest.splice(index, 1);
    return false;
  });
}
