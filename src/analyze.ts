// Analysis of one file's text: parse it into a syntax tree, run every rule, apply suppressions.
// Used by the scanner for every file, and by fix validation to re-check a fixed copy of a file
// in memory. Nothing here reads or writes files.

import ts from "typescript";
import * as lp001 from "./rules/lp001-empty-catch.js";
import * as lp002 from "./rules/lp002-lost-error-cause.js";
import * as lp003 from "./rules/lp003-unlogged-error-response.js";
import { applySuppressions, type SuppressionResult } from "./suppressions.js";
import type { Finding, Severity } from "./types.js";

/**
 * Every rule LogPilot has. `version` changes when a rule's behaviour changes (see the rule files).
 *
 * `provenLevels` (Milestone T, "default = proven only"): the severities whose precision on code the
 * rule was NOT designed on (a held-out measurement, docs/evaluation.md) is at least 70%. By default
 * only findings at these levels are shown; the others are hidden and counted in the summary. A level
 * is added here only after a NEW held-out measurement passes the gate, and removed when one fails.
 */
export const RULES: {
  id: string;
  name: string;
  version: number;
  provenLevels: readonly Severity[];
  check: (sourceFile: ts.SourceFile, filePath: string) => Finding[];
}[] = [
  // LP001: 3 of 25 real problems (12%), held-out round 3. No level passes.
  { id: lp001.RULE_ID, name: lp001.RULE_NAME, version: lp001.RULE_VERSION, provenLevels: [], check: lp001.checkEmptyCatch },
  // LP002: high 0/1, medium 1/3, low 1/9 (round 2); high 1/12 (round 1). No level passes.
  { id: lp002.RULE_ID, name: lp002.RULE_NAME, version: lp002.RULE_VERSION, provenLevels: [], check: lp002.checkLostErrorCause },
  // LP003: high 30/33 (91%) on 12 held-out apps. Case E (4xx, now low): 0/10.
  { id: lp003.RULE_ID, name: lp003.RULE_NAME, version: lp003.RULE_VERSION, provenLevels: ["high"], check: lp003.checkUnloggedErrorResponse },
];
export const KNOWN_RULE_IDS = RULES.map((rule) => rule.id);

/** Every rule: what fix validation runs, so a fix can never create any finding, shown or not. */
export const ALL_RULE_IDS: ReadonlySet<string> = new Set(KNOWN_RULE_IDS);

/**
 * How a rule is used in a scan:
 * - "proven" (the default): it runs, and only findings at its proven levels are shown; the others
 *   are hidden and counted;
 * - "on": it runs, and all its findings are shown;
 * - "off": it does not run.
 */
export type RuleSetting = "proven" | "on" | "off";
export const RULE_SETTINGS: readonly RuleSetting[] = ["proven", "on", "off"];

/**
 * Each rule's setting: "proven", then the config file's "rules", then --enable (which sets "on"
 * and wins over the config file, like every command-line option).
 */
export function ruleSettings(configRules: Readonly<Record<string, RuleSetting>> = {}, enable: readonly string[] = []): Map<string, RuleSetting> {
  const settings = new Map<string, RuleSetting>(RULES.map((rule) => [rule.id, "proven"]));
  for (const [id, value] of Object.entries(configRules)) settings.set(id, value);
  for (const id of enable) settings.set(id, "on");
  return settings;
}

/** Every rule "on": all findings of every rule (tests, and the self-scan of LogPilot's own code). */
export const ALL_RULES_ON: ReadonlyMap<string, RuleSetting> = new Map(RULES.map((rule) => [rule.id, "on"]));

/** The rules that run: every rule that is not "off". */
export function rulesThatRun(settings: ReadonlyMap<string, RuleSetting>): Set<string> {
  return new Set(RULES.filter((rule) => (settings.get(rule.id) ?? "proven") !== "off").map((rule) => rule.id));
}

/** Is this finding shown? Always for a rule that is "on"; for "proven", only at a proven level. */
export function isShown(finding: Finding, settings: ReadonlyMap<string, RuleSetting>): boolean {
  const setting = settings.get(finding.ruleId) ?? "proven";
  if (setting === "on") return true;
  return RULES.find((rule) => rule.id === finding.ruleId)?.provenLevels.includes(finding.severity) ?? false;
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
