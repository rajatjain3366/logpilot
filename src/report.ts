// Report: turns scan results into readable text for the terminal.
// Pure formatting: these functions return strings and never print anything themselves.

import { FIXABLE_RULES } from "./fixes.js";
import type { ScanResult } from "./scanner.js";
import type { Finding, Severity, SkippedPath, SkipReason } from "./types.js";

/** Long explanation/suggestion text is word-wrapped at this many columns when not in a terminal. */
export const DEFAULT_WIDTH = 100;
/** In a narrow terminal, text is still wrapped at least this wide. */
const MIN_WIDTH = 60;

/**
 * The width to wrap text at. In a terminal (a "TTY"): its width, between 60 and 100 columns, minus
 * one, because some terminals add an empty line when a line fills the last column. Piped or written
 * to a file (`> report.txt`, `--output`): always 100, so saved reports look the same everywhere.
 */
export function reportWidth(stdout: { isTTY?: boolean; columns?: number }, toFile: boolean): number {
  if (toFile || stdout.isTTY !== true || stdout.columns === undefined || stdout.columns <= 0) return DEFAULT_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, stdout.columns - 1));
}

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
  /** Repeat the full explanation, suggestion and fix notes for every finding (--verbose). */
  verbose?: boolean;
  /** Wrap text at this many columns (see reportWidth). Default: 100. */
  width?: number;
}

/**
 * What the report has already printed in full, so later findings of the same kind can refer back
 * to it in one line ("concise" output, the default). Keys map to the location printed first.
 */
interface ReportState {
  width: number;
  verbose: boolean;
  /** Rule + case -> where its full explanation was printed, and the suggestion printed there. */
  cases: Map<string, { location: string; suggestion: string }>;
  /** A fix note, a no-fix reason or a logger line -> where it was printed in full. */
  texts: Map<string, string>;
}

/** The full text report: every finding, then the summary. Ends with a newline. */
export function formatReport(result: ScanResult, options: ReportOptions = {}): string {
  const state: ReportState = {
    width: options.width ?? DEFAULT_WIDTH,
    verbose: options.verbose ?? false,
    cases: new Map(),
    texts: new Map(),
  };
  const sections = result.findings.map((finding) => formatFinding(finding, state));
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
 * The first finding of each rule and case gets the full Why and Fix; later ones of the same kind
 * get one line that points back to it (unless --verbose). The evidence is always shown.
 */
function formatFinding(finding: Finding, state: ReportState): string {
  const location = `${finding.file}:${finding.line}`;
  const lines = [
    `${finding.file}:${finding.line}:${finding.column}`,
    `  ${finding.ruleId} ${finding.ruleName} | severity: ${finding.severity} | confidence: ${finding.confidence}`,
    "  Evidence:",
    ...formatEvidence(finding),
  ];
  const key = caseKey(finding);
  const first = state.cases.get(key);
  if (state.verbose || first === undefined) {
    if (first === undefined) state.cases.set(key, { location, suggestion: finding.suggestion });
    lines.push(...wrap(`Why: ${finding.explanation}`, "  ", "       ", state.width));
    lines.push(...wrap(`Fix: ${finding.suggestion}`, "  ", "       ", state.width));
  } else {
    // The same kind of problem as a finding above. Only the parts of the suggestion that are new
    // here are printed (for example LP002's rewritten throw, or "write `catch (err)`").
    const where = refer(first.location, finding.file);
    const seen = new Set(sentences(first.suggestion).map(skeleton));
    const extra = sentences(finding.suggestion).filter((sentence) => !seen.has(skeleton(sentence)));
    if (extra.length === 0) {
      lines.push(...wrap(`Why and fix: same as for ${where} above.`, "  ", "    ", state.width));
    } else {
      lines.push(...wrap(`Why: same as for ${where} above.`, "  ", "       ", state.width));
      lines.push(...wrap(`Fix: ${extra.join(" ")} (The rest: same as for ${where} above.)`, "  ", "       ", state.width));
    }
  }
  lines.push(...formatFixPreview(finding, location, state));
  return lines.join("\n");
}

/**
 * Which "kind" a finding is, for concise output: the rule, its levels, and its explanation without
 * the first sentence (which names this finding's own status code or line), with names and numbers
 * blanked out. If two findings of one kind ever get different keys, the full text is simply
 * printed twice, which is harmless.
 */
function caseKey(finding: Finding): string {
  return [finding.ruleId, finding.severity, finding.confidence, sentences(finding.explanation).slice(1).map(skeleton).join(" ")].join("\u0000");
}

/** Splits text into sentences (a sentence ends with . ! or ? followed by a capital letter or "("). */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z(])/);
}

/** A sentence with the parts that differ between findings of one kind blanked out: names, numbers, quoted code. */
function skeleton(sentence: string): string {
  return sentence
    .replace(/`[^`]*`/g, "`_`")
    .replace(/"[^"]*"/g, '"_"')
    .replace(/\d+/g, "#")
    .replace(/\berr: [A-Za-z_$][\w$]*/g, "err") // { err: error, ... } and { err, ... }
    .replace(/\b[A-Za-z_$][\w$]*(?=\.(name|message)\b)/g, "_")
    .replace(/\(\s*[A-Za-z_$][\w$]*\s*\)/g, "(_)");
}

/** "line 14" for a location in the same file, else "src/a.js:14". */
function refer(location: string, file: string): string {
  return location.startsWith(`${file}:`) ? `line ${location.slice(file.length + 1)}` : location;
}

/** `text` wrapped in full the first time; afterwards one line saying where it was shown. */
function onceThenRefer(label: string, text: string, location: string, file: string, state: ReportState, indent: string, rest: string): string[] {
  const first = state.texts.get(`${label}\u0000${text}`);
  if (state.verbose || first === undefined) {
    if (first === undefined) state.texts.set(`${label}\u0000${text}`, location);
    return wrap(`${label}: ${text}`, indent, rest, state.width);
  }
  return wrap(`${label}: same as for ${refer(first, file)} above.`, indent, rest, state.width);
}

/**
 * --fix-preview: the proposed fix under a finding of a rule that has fixes, e.g.
 *   Proposed fix (preview only, not applied): Log the caught error with console.error ...
 *     Logger: console.error (confidence low: no logger was found in this file, ...)
 *     --- a/src/app.js
 *     ...
 *   Checked: ...
 * or "No fix proposed: <reason>". Rules without fixes (LP001, LP002) show nothing here.
 * The diff is always shown in full; logger lines, notes, reasons and "Checked" are shown in full
 * the first time, then referred back to (unless --verbose).
 */
function formatFixPreview(finding: Finding, location: string, state: ReportState): string[] {
  const fix = finding.fix;
  if (fix === undefined || !FIXABLE_RULES.has(finding.ruleId)) return [];
  const file = finding.file;
  if (fix.status === "not-available") return onceThenRefer("No fix proposed", fix.reason ?? "", location, file, state, "  ", "       ");
  const lines = wrap(`Proposed fix (preview only, not applied): ${fix.description ?? ""}`, "  ", "    ", state.width);
  if (fix.logger !== undefined) {
    const logger = `${fix.logger.call} (confidence ${fix.logger.confidence}: ${fix.logger.evidence})`;
    lines.push(...onceThenRefer("Logger", logger, location, file, state, "    ", "      "));
  }
  // The diff is never word-wrapped: its lines are code.
  lines.push(...(fix.diff ?? "").trimEnd().split("\n").map((line) => `    ${line}`));
  for (const note of fix.notes) lines.push(...onceThenRefer("Note", note, location, file, state, "  ", "        "));
  lines.push(...onceThenRefer("Checked", FIX_CHECKED, location, file, state, "  ", "           "));
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
  if (result.filesScanned > 0 && result.filesWithExpressHandlers === 0) {
    // Without this, "0 LP003 findings" in a Next.js or library project could look like a clean result.
    lines.push(NO_EXPRESS_LINE);
  }
  if (options.configFile !== undefined) lines.push(`Config file: ${options.configFile}`);
  if (options.fixPreview) {
    const fixable = result.findings.filter((f) => FIXABLE_RULES.has(f.ruleId) && f.fix !== undefined);
    const available = fixable.filter((f) => f.fix?.status === "available").length;
    lines.push(
      `Fix previews (LP003 only): ${available} available, ${fixable.length - available} not available.`,
      "No file was changed: apply a fix yourself after reviewing it.",
    );
  }
  return lines.join("\n");
}

/** Shown once in the summary when no scanned file has an Express handler. */
export const NO_EXPRESS_LINE = "No Express handlers found: LP003 and fix previews only check Express apps.";

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

/**
 * Word-wraps `text` at `width` columns. The first line starts with `firstIndent`, later lines with
 * `restIndent`. A single word longer than a line is not split (it may be code or a path).
 */
function wrap(text: string, firstIndent: string, restIndent: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = firstIndent + words[0];
  for (const word of words.slice(1)) {
    if (line.length + 1 + word.length > width) {
      lines.push(line);
      line = restIndent + word;
    } else {
      line += " " + word;
    }
  }
  lines.push(line);
  return lines;
}
