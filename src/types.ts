// Shared data types for LogPilot.
// These are TypeScript-only: they describe the shape of data and disappear
// completely when the code is compiled to JavaScript.

/** How much it hurts a failure investigation IF the finding is real. */
export type Severity = "high" | "medium" | "low";

/** How sure LogPilot is that the finding is a real problem, not a deliberate, harmless choice. */
export type Confidence = "high" | "medium" | "low";

/** One problem, found at one place in one file. */
export interface Finding {
  /** Stable rule ID, e.g. "LP001". Never changes once released, so users can rely on it. */
  ruleId: string;
  /** Short readable rule name, e.g. "empty-catch". */
  ruleName: string;
  /** Path of the file, as shown in the report (relative to the scanned folder, "/" separators). */
  file: string;
  /** 1-based line number where the problem starts. */
  line: number;
  /** 1-based column number where the problem starts. */
  column: number;
  severity: Severity;
  confidence: Confidence;
  /** The source code lines that show the problem, copied from the file (starting at `line`). */
  evidence: string;
  /** Why this is a problem, in plain language. */
  explanation: string;
  /** What to do about it. */
  suggestion: string;
  /**
   * The finding's pattern, for grouping repeated findings (LP001 and LP002; LP003 is never grouped).
   * Two findings with the same `id` have the same rule, case, levels, explanation template and code
   * shape (e.g. the same thrown class), so one explanation fits both. See patternOf in rules/shared.ts.
   */
  pattern?: FindingPattern;
  /** The proposed fix, only when the scan ran with --fix-preview. A preview: nothing is ever applied. */
  fix?: FixPreview;
}

/** What makes findings "the same pattern" (see Finding.pattern). */
export interface FindingPattern {
  /** Stable ID such as "LP002-3f2a9c1b": the rule ID and a hash of the pattern's parts. */
  id: string;
  /** Short readable description, e.g. "throw new ApiError(...) without the caught error". */
  label: string;
}

/**
 * One change to a file's text: the characters from `start` up to (not including) `end` are
 * replaced by `newText`. Offsets count JavaScript string characters (UTF-16 code units) in the
 * ORIGINAL text, as read from the file. start === end means a pure insertion.
 */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

/** Which logger a fix writes to. */
export type LoggerKind = "console" | "pino" | "winston" | "bunyan" | "project";

/** A proposed fix for one finding (--fix-preview). LogPilot shows it and never applies it. */
export interface FixPreview {
  status: "available" | "not-available";
  /** Why there is no fix (status "not-available"). */
  reason?: string;
  /** What the fix does, in one sentence. */
  description?: string;
  logger?: {
    kind: LoggerKind;
    /** The call the fix makes, e.g. "console.error". */
    call: string;
    /** How sure LogPilot is that this is the logger the project itself uses. */
    confidence: Confidence;
    /** Why this logger was chosen. */
    evidence: string;
  };
  /** Things to check before applying the fix by hand. */
  notes: string[];
  /** The edits, as offsets into the original file text. They never overlap. */
  edits: TextEdit[];
  /** A unified diff of the edits, for reading (line endings shown as plain new lines). */
  diff?: string;
  /**
   * Internal, never in the JSON report: the names the fix's inserted code may use, so `logpilot fix`
   * can check the fixes of one file together (validateFixSet in fix-validate.ts).
   */
  safety?: FixSafety;
}

/** The names a fix's inserted code may use (decided by the fixer, checked by fix-validate.ts). */
export interface FixSafety {
  /** The caught error's variable, e.g. "err". */
  errorName: string;
  /** The request parameter, e.g. "req", or undefined when the fix uses no request context. */
  requestName?: string;
  /** The logger the fix calls, e.g. "console" or "logger". */
  loggerName: string;
  /** Another key the error may be logged under, copied from the project's own log calls (e.g. "error"). */
  errorKey?: string;
}

/** Why LogPilot did not scan a file or folder. */
export type SkipReason =
  | "default-folder" //   a folder such as node_modules or dist
  | "minified-name" //    a file named *.min.js
  | "minified-content" // a file whose lines look minified
  | "vendored-banner" //  a copy of a third-party library (license banner with a version)
  | "user-exclude"; //    matched one of the user's exclude patterns

/** A file or folder that was not scanned, and why. */
export interface SkippedPath {
  /** As shown in the report: relative to the scanned folder, "/" separators. */
  path: string;
  kind: "file" | "folder";
  reason: SkipReason;
  /** Extra detail, e.g. the exclude pattern that matched. */
  detail?: string;
}

/** A finding hidden by a `logpilot-ignore` comment. */
export interface SuppressedFinding {
  finding: Finding;
  /** The reason written after "--" in the comment. */
  reason: string;
  /** 1-based line of the suppression comment. */
  commentLine: number;
}

/** A problem that did not stop the scan. */
export interface ScanWarning {
  type: "read-error" | "syntax-error" | "unused-exclude" | "invalid-suppression" | "unused-suppression" | "fix-validation-failed";
  /** The file or folder concerned, as shown in the report, if there is one. */
  file?: string;
  /** 1-based line, for syntax errors. */
  line?: number;
  /** The full message, as printed after "Warning: ". */
  message: string;
}
