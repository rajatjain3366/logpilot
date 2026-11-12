// Report: turns scan results into readable text for the terminal.
// Pure formatting: these functions return strings and never print anything themselves.

import { FIXABLE_RULES } from "./fixes.js";
import type { ScanResult } from "./scanner.js";
import type { Finding, Severity, SkippedPath, SkipReason } from "./types.js";

/** Long explanation/suggestion text is word-wrapped at this many columns. */
const WRAP_WIDTH = 100;

/** How each skip reason is named in the summary, in the order it is listed there. */
const SKIP_REASON_LABELS: [SkipReason[], string][] = [
  [["default-folder"], "default folders"],
  [["minified-name", "minified-content"], "minified"],
  [["vendored-banner"], "vendored"],
  [["user-exclude"], "your exclude patterns"],
];

export interface ReportOptions {
  /** List every skipped file and folder (--show-skipped). */
  showSkipped?: boolean;
  /** The config file that was used, as shown to the user. */
  configFile?: string;
  /** How many findings were left out because of --min-severity, and the level used. */
  hiddenBelowMinSeverity?: number;
  minSeverity?: Severity;
  /** The scan ran with --fix-preview: show the proposed fixes and count them in the summary. */
  fixPreview?: boolean;
}

/** The full text report: every finding, then the summary. Ends with a newline. */
export function formatReport(result: ScanResult, options: ReportOptions = {}): string {
  const sections = result.findings.map(formatFinding);
  sections.push(formatSummary(result, options));
  if (options.showSkipped && result.skipped.length > 0) {
    sections.push(formatSkippedList(result.skipped));
  }
  return sections.join("\n\n") + "\n";
}

/**
 * One finding, e.g.
 *   src/config.ts:9:5
 *     LP001 empty-catch | severity: high | confidence: high
 *     Evidence:
 *        9 |   } catch (err) {}
 *     Why: ...
 *     Fix: ...
 */
function formatFinding(finding: Finding): string {
  return [
    `${finding.file}:${finding.line}:${finding.column}`,
    `  ${finding.ruleId} ${finding.ruleName} | severity: ${finding.severity} | confidence: ${finding.confidence}`,
    "  Evidence:",
    ...formatEvidence(finding),
    ...wrap(`Why: ${finding.explanation}`, "  ", "       "),
    ...wrap(`Fix: ${finding.suggestion}`, "  ", "       "),
    ...formatFixPreview(finding),
  ].join("\n");
}

/**
 * --fix-preview: the proposed fix under a finding of a rule that has fixes, e.g.
 *   Proposed fix (preview only, not applied): Log the caught error with console.error ...
 *     Logger: console.error (confidence low: no logger was found in this file, ...)
 *     --- a/src/app.js
 *     ...
 *   Checked: ...
 * or "No fix proposed: <reason>". Rules without fixes (LP001, LP002) show nothing here.
 */
function formatFixPreview(finding: Finding): string[] {
  const fix = finding.fix;
  if (fix === undefined || !FIXABLE_RULES.has(finding.ruleId)) return [];
  if (fix.status === "not-available") return wrap(`No fix proposed: ${fix.reason ?? ""}`, "  ", "       ");
  const lines = wrap(`Proposed fix (preview only, not applied): ${fix.description ?? ""}`, "  ", "    ");
  if (fix.logger !== undefined) {
    lines.push(...wrap(`Logger: ${fix.logger.call} (confidence ${fix.logger.confidence}: ${fix.logger.evidence})`, "    ", "      "));
  }
  // The diff is not word-wrapped: its lines are code.
  lines.push(...(fix.diff ?? "").trimEnd().split("\n").map((line) => `    ${line}`));
  for (const note of fix.notes) lines.push(...wrap(`Note: ${note}`, "  ", "        "));
  lines.push(...wrap(`Checked: ${FIX_CHECKED}`, "  ", "           "));
  return lines;
}

/** What every shown fix has passed (see fix-validate.ts). */
const FIX_CHECKED =
  "the fixed code parses, the fix only adds code, it logs nothing but the error, req.method and req.route?.path, " +
  "and after it this finding is gone and no other finding changes.";

/** Evidence lines with their line numbers in a right-aligned gutter. */
function formatEvidence(finding: Finding): string[] {
  const codeLines = finding.evidence.split("\n");
  const gutterWidth = String(finding.line + codeLines.length - 1).length;
  return codeLines.map((code, i) => `    ${String(finding.line + i).padStart(gutterWidth)} | ${code}`);
}

/**
 * The summary lines, e.g.
 *   Scanned 7 files, 6 findings (LP001: 6)
 *   Not scanned: 2 files and 3 folders (default folders: 3, minified: 2). Run with --show-skipped to list them.
 */
function formatSummary(result: ScanResult, options: ReportOptions): string {
  const lines = [formatScannedLine(result)];
  const hidden = options.hiddenBelowMinSeverity ?? 0;
  if (hidden > 0) {
    lines.push(
      `${plural(hidden, "finding")} below ${options.minSeverity} severity ${hidden === 1 ? "is" : "are"} not shown (--min-severity).`,
    );
  }
  if (result.suppressed.length > 0) {
    const count = result.suppressed.length;
    lines.push(`${plural(count, "finding")} ${count === 1 ? "was" : "were"} suppressed by logpilot-ignore comments.`);
  }
  const skippedLine = formatSkippedLine(result.skipped, options);
  if (skippedLine) lines.push(skippedLine);
  const brokenFiles = new Set(result.warnings.filter((w) => w.type === "syntax-error").map((w) => w.file)).size;
  if (brokenFiles > 0) {
    lines.push(
      `${plural(brokenFiles, "file")} had syntax errors; findings in ${brokenFiles === 1 ? "it" : "them"} ` +
        "may be incomplete (see the warnings).",
    );
  }
  if (options.configFile !== undefined) lines.push(`Config file: ${options.configFile}`);
  if (options.fixPreview) {
    const fixable = result.findings.filter((f) => FIXABLE_RULES.has(f.ruleId) && f.fix !== undefined);
    const available = fixable.filter((f) => f.fix?.status === "available").length;
    lines.push(
      `Fix previews (LP003 only): ${available} available, ${fixable.length - available} not available. ` +
        "No file was changed: apply a fix yourself after reviewing it.",
    );
  }
  return lines.join("\n");
}

/** e.g. "Scanned 7 files, 6 findings (LP001: 6)" or "Scanned 4 files, 0 findings". */
function formatScannedLine(result: ScanResult): string {
  const files = plural(result.filesScanned, "file");
  const findings = plural(result.findings.length, "finding");
  if (result.findings.length === 0) {
    return `Scanned ${files}, ${findings}`;
  }

  const countsByRule = new Map<string, number>();
  for (const finding of result.findings) {
    countsByRule.set(finding.ruleId, (countsByRule.get(finding.ruleId) ?? 0) + 1);
  }
  const breakdown = [...countsByRule]
    .sort(([a], [b]) => (a < b ? -1 : 1)) // LP001 before LP002, whichever was found first
    .map(([ruleId, count]) => `${ruleId}: ${count}`)
    .join(", ");
  return `Scanned ${files}, ${findings} (${breakdown})`;
}

/** How much was NOT scanned, by reason. Nothing at all when nothing was skipped. */
function formatSkippedLine(skipped: SkippedPath[], options: ReportOptions): string | undefined {
  if (skipped.length === 0) return undefined;
  const files = skipped.filter((s) => s.kind === "file").length;
  const folders = skipped.length - files;
  const what = [files > 0 ? plural(files, "file") : "", folders > 0 ? plural(folders, "folder") : ""]
    .filter((part) => part !== "")
    .join(" and ");
  const byReason = SKIP_REASON_LABELS.map(([reasons, label]) => [label, skipped.filter((s) => reasons.includes(s.reason)).length] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}: ${count}`)
    .join(", ");
  const hint = options.showSkipped ? "" : " Run with --show-skipped to list them.";
  return `Not scanned: ${what} (${byReason}).${hint}`;
}

/**
 * --show-skipped: every skipped path with its reason, e.g.
 *   Not scanned (1 file, 2 folders):
 *     folder  node_modules  (dependencies, never scanned)
 *     file    public/app.min.js  (minified: the file name ends in .min.js)
 * The path is not padded into a column, so long paths cannot break the layout.
 */
function formatSkippedList(skipped: SkippedPath[]): string {
  const files = skipped.filter((s) => s.kind === "file").length;
  const header = `Not scanned (${plural(files, "file")}, ${plural(skipped.length - files, "folder")}):`;
  const rows = skipped.map((s) => `  ${s.kind.padEnd(6)}  ${s.path}  (${s.detail ?? s.reason})`);
  return [header, ...rows].join("\n");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Word-wraps `text` at WRAP_WIDTH. The first line starts with `firstIndent`, later lines with `restIndent`. */
function wrap(text: string, firstIndent: string, restIndent: string): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = firstIndent + words[0];
  for (const word of words.slice(1)) {
    if (line.length + 1 + word.length > WRAP_WIDTH) {
      lines.push(line);
      line = restIndent + word;
    } else {
      line += " " + word;
    }
  }
  lines.push(line);
  return lines;
}
