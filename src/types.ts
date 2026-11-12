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
  /** Path of the file, as shown in the report (relative to the current folder, "/" separators). */
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
  /** As shown in the report: relative to the current folder, "/" separators. */
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
  type: "read-error" | "syntax-error" | "unused-exclude" | "invalid-suppression" | "unused-suppression";
  /** The file or folder concerned, as shown in the report, if there is one. */
  file?: string;
  /** 1-based line, for syntax errors. */
  line?: number;
  /** The full message, as printed after "Warning: ". */
  message: string;
}
