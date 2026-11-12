// Severity levels: their order, and the two settings that use them.
//   minSeverity: which findings are SHOWN (default "low": everything)
//   failOn:      which findings make the exit code 1 (default "none": never; warning-only)
// The defaults are deliberately cautious: our own measurements show severity is not reliable yet
// (most real problems found on unseen code were reported as low; see docs/evaluation.md).

import type { Severity } from "./types.js";

/** "none" never fails the scan. */
export type FailOn = Severity | "none";

export const SEVERITIES: readonly Severity[] = ["low", "medium", "high"];
export const FAIL_ON_LEVELS: readonly FailOn[] = ["none", "low", "medium", "high"];

export const DEFAULT_MIN_SEVERITY: Severity = "low";
export const DEFAULT_FAIL_ON: FailOn = "none";

/** low = 0, medium = 1, high = 2. */
export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export function isSeverity(value: unknown): value is Severity {
  return SEVERITIES.includes(value as Severity);
}

export function isFailOn(value: unknown): value is FailOn {
  return FAIL_ON_LEVELS.includes(value as FailOn);
}

/**
 * What is wrong with this combination, or undefined if it is fine. Failing on a level below the
 * one that is shown would fail the scan because of findings nobody can see.
 */
export function checkLevels(minSeverity: Severity, failOn: FailOn): string | undefined {
  if (failOn !== "none" && severityRank(failOn) < severityRank(minSeverity)) {
    return (
      `fail-on "${failOn}" is below min-severity "${minSeverity}": LogPilot would fail on findings it does not show; ` +
      `use a fail-on level of "${minSeverity}" or higher, or "none"`
    );
  }
  return undefined;
}
