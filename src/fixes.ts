// Fix previews (--fix-preview): attaches a proposed fix, or the reason there is none, to each
// finding of one file. Every proposal is checked in memory (fix-validate.ts) before it is shown.
// Nothing here writes to disk: a fix is only text edits and a diff, never applied to a file.

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import type ts from "typescript";
import { unifiedDiff } from "./fix-edits.js";
import { validateFix } from "./fix-validate.js";
import { proposeLp003Fixes } from "./rules/lp003-fix.js";
import type { Finding, FixPreview, ScanWarning } from "./types.js";

/** Rules that can have a proposed fix. */
export const FIXABLE_RULES = new Set(["LP003"]);

/** Why the other rules get no automatic fix. */
const NO_FIX: Record<string, string> = {
  LP001:
    "No automatic fix for an empty catch: it needs a human decision (log the error, rethrow it, return a fallback " +
    "value, or explain why it is ignored).",
  LP002:
    "No automatic fix from LogPilot: ESLint's preserve-caught-error rule offers one in your editor (it adds { cause: err }).",
};

/**
 * A reader for logger detection (a relative import such as ./utils/logger). Read-only, and only
 * regular files inside `scanRoot`, the folder being scanned: an import that leads outside it
 * (../../shared/logger) or through a symbolic link is not read, like the scan itself, and the
 * logger is then treated as unknown. Logger detection never follows more than one import.
 */
export function moduleReader(scanRoot: string): (absolutePath: string) => string | undefined {
  return (absolutePath) => {
    const relative = path.relative(scanRoot, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    try {
      return lstatSync(absolutePath).isFile() ? readFileSync(absolutePath, "utf8") : undefined;
    } catch {
      return undefined; // missing or unreadable
    }
  };
}

function notAvailable(reason: string): FixPreview {
  return { status: "not-available", reason, notes: [], edits: [] };
}

/**
 * Sets `fix` on every finding in `findings` (all from `sourceFile`). Returns warnings for fixes
 * that failed validation: those are LogPilot bugs, and the fix is not shown. `scanRoot` is the
 * scanned folder: logger detection may read one imported module inside it (see moduleReader).
 */
export function attachFixPreviews(
  sourceFile: ts.SourceFile,
  displayPath: string,
  findings: Finding[],
  hasSyntaxErrors: boolean,
  scanRoot: string = path.dirname(sourceFile.fileName),
): ScanWarning[] {
  const warnings: ScanWarning[] = [];
  const proposals =
    !hasSyntaxErrors && findings.some((f) => FIXABLE_RULES.has(f.ruleId))
      ? proposeLp003Fixes(sourceFile, moduleReader(scanRoot))
      : new Map();
  for (const finding of findings) {
    if (!FIXABLE_RULES.has(finding.ruleId)) {
      finding.fix = notAvailable(NO_FIX[finding.ruleId] ?? "No automatic fix for this rule.");
      continue;
    }
    if (hasSyntaxErrors) {
      finding.fix = notAvailable("No fix: the file has syntax errors, so LogPilot cannot check a fix.");
      continue;
    }
    const proposal = proposals.get(`${finding.line}:${finding.column}`);
    if (proposal === undefined) {
      finding.fix = notAvailable("No fix: LogPilot could not find this code again (this is a LogPilot bug, please report it).");
      continue;
    }
    if (!proposal.ok) {
      finding.fix = notAvailable(proposal.reason);
      continue;
    }
    const problem = validateFix(sourceFile.fileName, displayPath, sourceFile.text, finding, proposal.edits, proposal.safety);
    if (problem !== undefined) {
      finding.fix = notAvailable(`No fix: LogPilot's proposed fix failed its own checks (${problem}), so it is not shown.`);
      warnings.push({
        type: "fix-validation-failed",
        file: displayPath,
        line: finding.line,
        message: `${displayPath}:${finding.line}: the proposed fix was not shown because ${problem} (this is a LogPilot bug, please report it)`,
      });
      continue;
    }
    finding.fix = {
      status: "available",
      description: proposal.description,
      logger: proposal.logger,
      notes: proposal.notes,
      edits: proposal.edits,
      diff: unifiedDiff(displayPath, sourceFile.text, proposal.edits),
    };
  }
  return warnings;
}
