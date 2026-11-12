// Scanner: finds source files under a path, parses each one into a syntax tree,
// and runs every rule on it. This module only READS files; nothing here writes to disk.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { checkSourceFile, findSyntaxErrors, parseSource } from "./analyze.js";
import { ExcludePatterns, fileSkipByContent, fileSkipByName, folderSkip } from "./file-selection.js";
import { attachFixPreviews } from "./fixes.js";
import { findExpressHandlers } from "./rules/express.js";
import type { Finding, ScanWarning, SkippedPath, SuppressedFinding } from "./types.js";

export { parseSource, RULES } from "./analyze.js";

/** File extensions LogPilot scans (also used to refuse writing a report into a source file). */
export const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);

export interface ScanResult {
  filesScanned: number;
  /** Scanned files with at least one Express handler (LP003 and fix previews look only at those). */
  filesWithExpressHandlers: number;
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
  /** Attach a proposed fix (or the reason there is none) to each finding. Never applied. Default: false. */
  fixPreview?: boolean;
}

/**
 * The folder a scan of `absoluteTarget` reports paths from: the folder itself, or for a single
 * file, the folder that contains it. Every path in the report is relative to this folder.
 */
export function scanRootOf(absoluteTarget: string): string {
  return statSync(absoluteTarget, { throwIfNoEntry: false })?.isDirectory() ? absoluteTarget : path.dirname(absoluteTarget);
}

/**
 * Scans one file or a whole folder and returns the findings.
 * Throws an Error when the scan cannot start (path missing, or not a JS/TS file).
 * `cwd` is only used to find `targetPath` when it is relative. Paths in the result are relative to
 * the scanned folder (see scanRootOf), whatever `cwd` is.
 */
export function scanPath(targetPath: string, cwd: string = process.cwd(), options: ScanOptions = {}): ScanResult {
  const defaultExcludes = options.defaultExcludes ?? true;
  const absoluteTarget = path.resolve(cwd, targetPath);
  const stats = statSync(absoluteTarget, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error(`path "${targetPath}" does not exist`);
  }

  const result: ScanResult = { filesScanned: 0, filesWithExpressHandlers: 0, findings: [], suppressed: [], warnings: [], skipped: [] };
  const scanRoot = scanRootOf(absoluteTarget);
  const excludeRoot = options.excludeRoot ?? scanRoot;
  const excludes = new ExcludePatterns(options.exclude ?? [], excludeRoot);
  let files: string[];
  if (stats.isDirectory()) {
    files = findSourceFiles(absoluteTarget, { scanRoot, defaultExcludes, excludes, result });
  } else if (isSourceFile(absoluteTarget)) {
    files = [absoluteTarget];
  } else {
    throw new Error(
      `"${targetPath}" is not a JavaScript or TypeScript file (expected ${[...SOURCE_EXTENSIONS].join(", ")})`,
    );
  }

  // Sort by the printed path so the report is identical on every run and every OS.
  const sorted = files
    .map((file) => ({ file, displayPath: toDisplayPath(file, scanRoot) }))
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
    const { kept, suppressed, warnings } = checkSourceFile(sourceFile, displayPath);
    // Only to tell the user when LP003 had nothing to check (it looks at Express handlers only).
    if (findExpressHandlers(sourceFile).length > 0) result.filesWithExpressHandlers++;
    if (options.fixPreview) {
      // Proposed fixes are made and checked in memory, from the text already read: nothing is written.
      // Logger detection may read one imported module, but only inside the scanned folder.
      warnings.push(...attachFixPreviews(sourceFile, displayPath, kept, syntaxErrors.length > 0, scanRoot));
    }
    result.findings.push(...kept);
    result.suppressed.push(...suppressed);
    result.warnings.push(...warnings);
    result.filesScanned++;
  }
  result.skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const pattern of excludes.unused()) {
    const root = toDisplayPath(excludeRoot, scanRoot);
    result.warnings.push({
      type: "unused-exclude",
      message: `exclude pattern "${pattern}" matched nothing (patterns are relative to ${root}); check the spelling`,
    });
  }
  return result;
}

/** What a folder walk needs: where paths are shown from, which defaults apply, and where to record skips. */
interface WalkContext {
  scanRoot: string;
  defaultExcludes: boolean;
  excludes: ExcludePatterns;
  result: ScanResult;
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
        walk.result.skipped.push({ path: toDisplayPath(fullPath, walk.scanRoot), kind: "folder", ...skip });
      } else if (pattern !== undefined) {
        walk.result.skipped.push({
          path: toDisplayPath(fullPath, walk.scanRoot),
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

/**
 * A path as shown to the user: relative to `root` (the scanned folder), with "/" separators on
 * every OS, so the output is the same wherever LogPilot is run from. `root` itself is ".". A path on
 * another drive than `root` (only possible for a --config file) stays absolute, with "/".
 */
export function toDisplayPath(file: string, root: string): string {
  return path.relative(root, file).split(path.sep).join("/") || ".";
}
