// Scanner: finds source files under a path, parses each one into a syntax tree,
// and runs every rule on it. This module only READS files; nothing here writes to disk.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ExcludePatterns, fileSkipByContent, fileSkipByName, folderSkip } from "./file-selection.js";
import * as lp001 from "./rules/lp001-empty-catch.js";
import * as lp002 from "./rules/lp002-lost-error-cause.js";
import * as lp003 from "./rules/lp003-unlogged-error-response.js";
import { applySuppressions } from "./suppressions.js";
import type { Finding, ScanWarning, SkippedPath, SuppressedFinding } from "./types.js";

/** File extensions LogPilot scans (also used to refuse writing a report into a source file). */
export const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);

/** Every rule runs on every file. `version` changes when a rule's behaviour changes (see the rule files). */
export const RULES = [
  { id: lp001.RULE_ID, name: lp001.RULE_NAME, version: lp001.RULE_VERSION, check: lp001.checkEmptyCatch },
  { id: lp002.RULE_ID, name: lp002.RULE_NAME, version: lp002.RULE_VERSION, check: lp002.checkLostErrorCause },
  { id: lp003.RULE_ID, name: lp003.RULE_NAME, version: lp003.RULE_VERSION, check: lp003.checkUnloggedErrorResponse },
];
const KNOWN_RULE_IDS = RULES.map((rule) => rule.id);

export interface ScanResult {
  filesScanned: number;
  findings: Finding[];
  /** Findings hidden by `logpilot-ignore` comments, with the reason given there. */
  suppressed: SuppressedFinding[];
  /** Problems that did not stop the scan, e.g. a file that could not be read. */
  warnings: ScanWarning[];
  /** Files and folders that were not scanned, and why. */
  skipped: SkippedPath[];
}

/** Settings that decide which files are scanned. */
export interface ScanOptions {
  /** Skip default folders (dist, build, vendor, ...), minified and vendored files. Default: true. */
  defaultExcludes?: boolean;
  /** The user's exclude patterns (glob patterns), relative to `excludeRoot`. */
  exclude?: readonly string[];
  /** The folder the exclude patterns are relative to. Default: the scanned folder (or the file's folder). */
  excludeRoot?: string;
}

/**
 * Scans one file or a whole folder and returns the findings.
 * Throws an Error when the scan cannot start (path missing, or not a JS/TS file).
 * `cwd` is only used to print short, relative file paths.
 */
export function scanPath(targetPath: string, cwd: string = process.cwd(), options: ScanOptions = {}): ScanResult {
  const defaultExcludes = options.defaultExcludes ?? true;
  const absoluteTarget = path.resolve(cwd, targetPath);
  const stats = statSync(absoluteTarget, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error(`path "${targetPath}" does not exist`);
  }

  const result: ScanResult = { filesScanned: 0, findings: [], suppressed: [], warnings: [], skipped: [] };
  const excludeRoot = options.excludeRoot ?? (stats.isDirectory() ? absoluteTarget : path.dirname(absoluteTarget));
  const excludes = new ExcludePatterns(options.exclude ?? [], excludeRoot);
  let files: string[];
  if (stats.isDirectory()) {
    files = findSourceFiles(absoluteTarget, { cwd, defaultExcludes, excludes, result });
  } else if (isSourceFile(absoluteTarget)) {
    files = [absoluteTarget];
  } else {
    throw new Error(
      `"${targetPath}" is not a JavaScript or TypeScript file (expected ${[...SOURCE_EXTENSIONS].join(", ")})`,
    );
  }

  // Sort by the printed path so the report is identical on every run and every OS.
  const sorted = files
    .map((file) => ({ file, displayPath: toDisplayPath(file, cwd) }))
    .sort((a, b) => (a.displayPath < b.displayPath ? -1 : a.displayPath > b.displayPath ? 1 : 0));

  for (const { file, displayPath } of sorted) {
    const pattern = excludes.match(file, "file");
    if (pattern !== undefined) {
      result.skipped.push({ path: displayPath, kind: "file", reason: "user-exclude", detail: `your exclude pattern "${pattern}"` });
      continue;
    }
    const skipByName = defaultExcludes ? fileSkipByName(path.basename(file)) : undefined;
    if (skipByName) {
      result.skipped.push({ path: displayPath, kind: "file", ...skipByName });
      continue;
    }
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      result.warnings.push({
        type: "read-error",
        file: displayPath,
        message: `could not read ${displayPath}: ${(error as Error).message}`,
      });
      continue;
    }
    const skipByContent = defaultExcludes ? fileSkipByContent(text) : undefined;
    if (skipByContent) {
      result.skipped.push({ path: displayPath, kind: "file", ...skipByContent });
      continue;
    }
    const sourceFile = parseSource(file, text);
    const syntaxErrors = findSyntaxErrors(sourceFile);
    if (syntaxErrors.length > 0) {
      const first = syntaxErrors[0];
      const line = first.start === undefined ? 1 : sourceFile.getLineAndCharacterOfPosition(first.start).line + 1;
      const count = syntaxErrors.length === 1 ? "1 syntax error" : `${syntaxErrors.length} syntax errors`;
      result.warnings.push({
        type: "syntax-error",
        file: displayPath,
        line,
        message:
          `${displayPath}: ${count} (first at line ${line}: ${ts.flattenDiagnosticMessageText(first.messageText, " ")}); ` +
          "findings in this file may be incomplete",
      });
    }
    const fileFindings = RULES.flatMap((rule) => rule.check(sourceFile, displayPath));
    // List each file's findings from top to bottom, whichever rule produced them (then by rule ID,
    // so the order is the same on every run).
    fileFindings.sort((a, b) => a.line - b.line || a.column - b.column || (a.ruleId < b.ruleId ? -1 : 1));
    const { kept, suppressed, warnings } = applySuppressions(sourceFile, displayPath, fileFindings, KNOWN_RULE_IDS);
    result.findings.push(...kept);
    result.suppressed.push(...suppressed);
    result.warnings.push(...warnings);
    result.filesScanned++;
  }
  result.skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const pattern of excludes.unused()) {
    const root = toDisplayPath(excludeRoot, cwd) || ".";
    result.warnings.push({
      type: "unused-exclude",
      message: `exclude pattern "${pattern}" matched nothing (patterns are relative to ${root}); check the spelling`,
    });
  }
  return result;
}

/** What a folder walk needs: where paths are shown from, which defaults apply, and where to record skips. */
interface WalkContext {
  cwd: string;
  defaultExcludes: boolean;
  excludes: ExcludePatterns;
  result: ScanResult;
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
function findSyntaxErrors(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
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
 * Recursively collects source files under `dir`. Skipped folders are not entered at all
 * (they are recorded in `result.skipped`), so even a huge node_modules costs nothing.
 */
function findSourceFiles(dir: string, walk: WalkContext): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    walk.result.warnings.push({ type: "read-error", message: `could not read folder ${dir}: ${(error as Error).message}` });
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const skip = folderSkip(entry.name, walk.defaultExcludes);
      const pattern = skip ? undefined : walk.excludes.match(fullPath, "folder");
      if (skip) {
        walk.result.skipped.push({ path: toDisplayPath(fullPath, walk.cwd), kind: "folder", ...skip });
      } else if (pattern !== undefined) {
        walk.result.skipped.push({
          path: toDisplayPath(fullPath, walk.cwd),
          kind: "folder",
          reason: "user-exclude",
          detail: `your exclude pattern "${pattern}"`,
        });
      } else {
        files.push(...findSourceFiles(fullPath, walk));
      }
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      files.push(fullPath);
    }
    // Anything else (e.g. symbolic links) is ignored, so the walk can never loop forever.
  }
  return files;
}

/** True for .js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts files, except type declaration files (.d.ts). */
function isSourceFile(fileName: string): boolean {
  if (/\.d\.[cm]?ts$/i.test(fileName)) {
    return false; // .d.ts files only describe types; they contain no runtime code
  }
  return SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

/** Path relative to `cwd`, with "/" separators on every OS (so output looks the same everywhere). */
function toDisplayPath(file: string, cwd: string): string {
  return path.relative(cwd, file).split(path.sep).join("/");
}
