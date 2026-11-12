// Analysis of one file's text: parse it into a syntax tree, run every rule, apply suppressions.
// Used by the scanner for every file, and by fix validation to re-check a fixed copy of a file
// in memory. Nothing here reads or writes files.

import ts from "typescript";
import * as lp001 from "./rules/lp001-empty-catch.js";
import * as lp002 from "./rules/lp002-lost-error-cause.js";
import * as lp003 from "./rules/lp003-unlogged-error-response.js";
import { applySuppressions, type SuppressionResult } from "./suppressions.js";

/** Every rule runs on every file. `version` changes when a rule's behaviour changes (see the rule files). */
export const RULES = [
  { id: lp001.RULE_ID, name: lp001.RULE_NAME, version: lp001.RULE_VERSION, check: lp001.checkEmptyCatch },
  { id: lp002.RULE_ID, name: lp002.RULE_NAME, version: lp002.RULE_VERSION, check: lp002.checkLostErrorCause },
  { id: lp003.RULE_ID, name: lp003.RULE_NAME, version: lp003.RULE_VERSION, check: lp003.checkUnloggedErrorResponse },
];
export const KNOWN_RULE_IDS = RULES.map((rule) => rule.id);

/**
 * Turns source text into a syntax tree (AST). Read-only: it works on a string we already read.
 * TypeScript picks the right flavour (JS, JSX, TS or TSX) from the file extension.
 * The parser is error-tolerant: a file with a syntax error still produces a tree.
 */
export function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ true);
}

/**
 * The syntax errors TypeScript found while parsing `sourceFile`. The parser is error-tolerant, so
 * the file was still parsed, but the parts around an error may be missing or misread.
 * TypeScript only exposes these through a "Program"; this one contains just the file we already
 * parsed (no other files, no type libraries), so nothing is read or parsed a second time.
 */
export function findSyntaxErrors(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  const sameFile = (name: string) => name.replace(/\\/g, "/") === sourceFile.fileName.replace(/\\/g, "/");
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (sameFile(name) ? sourceFile : undefined),
    fileExists: sameFile,
    readFile: () => undefined,
    writeFile: () => {}, // never called: we only ask for diagnostics, nothing is emitted
    getDefaultLibFileName: () => "lib.d.ts",
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({
    rootNames: [sourceFile.fileName],
    options: { noLib: true, noResolve: true, allowJs: true, types: [] },
    host,
  });
  return program.getSyntacticDiagnostics(sourceFile);
}

/**
 * Runs every rule on one parsed file and applies its suppression comments. Findings are listed
 * from top to bottom, whichever rule produced them (then by rule ID, so the order never changes).
 */
export function checkSourceFile(sourceFile: ts.SourceFile, displayPath: string): SuppressionResult {
  const findings = RULES.flatMap((rule) => rule.check(sourceFile, displayPath));
  findings.sort((a, b) => a.line - b.line || a.column - b.column || (a.ruleId < b.ruleId ? -1 : 1));
  return applySuppressions(sourceFile, displayPath, findings, KNOWN_RULE_IDS);
}
