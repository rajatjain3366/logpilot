// Analysis of one file's text: parse it into a syntax tree, run every rule, apply suppressions.
// Used by the scanner for every file, and by fix validation to re-check a fixed copy of a file
// in memory. Nothing here reads or writes files.

import ts from "typescript";
import * as lp001 from "./rules/lp001-empty-catch.js";
import * as lp002 from "./rules/lp002-lost-error-cause.js";
import * as lp003 from "./rules/lp003-unlogged-error-response.js";
import { applySuppressions, type SuppressionResult } from "./suppressions.js";
import type { Finding } from "./types.js";

/**
 * Every rule LogPilot has. `version` changes when a rule's behaviour changes (see the rule files).
 * `defaultEnabled`: whether the rule runs when neither the config file ("rules") nor --enable
 * says otherwise. A rule that is off by default says why in `offByDefaultReason` (shown in the
 * summary, so nobody mistakes "0 findings" for "checked and fine").
 */
export const RULES: {
  id: string;
  name: string;
  version: number;
  defaultEnabled: boolean;
  offByDefaultReason?: string;
  check: (sourceFile: ts.SourceFile, filePath: string) => Finding[];
}[] = [
  {
    id: lp001.RULE_ID,
    name: lp001.RULE_NAME,
    version: lp001.RULE_VERSION,
    // v0.4.3: on real projects, most empty catches were deliberate (held-out: 3 of 25 real problems;
    // early testers: 0 of 6), so LP001 is opt-in. See docs/evaluation.md.
    defaultEnabled: false,
    offByDefaultReason: "most empty catches are deliberate",
    check: lp001.checkEmptyCatch,
  },
  { id: lp002.RULE_ID, name: lp002.RULE_NAME, version: lp002.RULE_VERSION, defaultEnabled: true, check: lp002.checkLostErrorCause },
  { id: lp003.RULE_ID, name: lp003.RULE_NAME, version: lp003.RULE_VERSION, defaultEnabled: true, check: lp003.checkUnloggedErrorResponse },
];
export const KNOWN_RULE_IDS = RULES.map((rule) => rule.id);

/** Every rule, on or off: what fix validation runs, so a fix can never create any finding. */
export const ALL_RULE_IDS: ReadonlySet<string> = new Set(KNOWN_RULE_IDS);

/** The rules that run when nothing turns a rule on or off. */
export const DEFAULT_ENABLED_RULE_IDS: ReadonlySet<string> = new Set(RULES.filter((rule) => rule.defaultEnabled).map((rule) => rule.id));

/**
 * The rules that run: the defaults, then the config file's "rules" (`"on"`/`"off"`), then the
 * --enable flags, which win over the config file like every command-line option.
 */
export function enabledRuleIds(configRules: Readonly<Record<string, "on" | "off">> = {}, enable: readonly string[] = []): Set<string> {
  const enabled = new Set(DEFAULT_ENABLED_RULE_IDS);
  for (const [id, value] of Object.entries(configRules)) {
    if (value === "on") enabled.add(id);
    else enabled.delete(id);
  }
  for (const id of enable) enabled.add(id);
  return enabled;
}

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
 * Runs the enabled rules on one parsed file and applies its suppression comments. Findings are
 * listed from top to bottom, whichever rule produced them (then by rule ID, so the order never
 * changes). Without `enabledRules`, every rule runs (fix validation relies on that).
 */
export function checkSourceFile(
  sourceFile: ts.SourceFile,
  displayPath: string,
  enabledRules: ReadonlySet<string> = ALL_RULE_IDS,
): SuppressionResult {
  const findings = RULES.filter((rule) => enabledRules.has(rule.id)).flatMap((rule) => rule.check(sourceFile, displayPath));
  findings.sort((a, b) => a.line - b.line || a.column - b.column || (a.ruleId < b.ruleId ? -1 : 1));
  return applySuppressions(sourceFile, displayPath, findings, KNOWN_RULE_IDS, enabledRules);
}
