// Tests for src/severity.ts: level order and the --min-severity / --fail-on combination check.

import { describe, expect, it } from "vitest";
import { checkLevels, isFailOn, isSeverity, severityRank } from "../src/severity.js";

describe("severity levels", () => {
  it("orders low < medium < high", () => {
    expect([severityRank("low"), severityRank("medium"), severityRank("high")]).toEqual([0, 1, 2]);
  });

  it("recognises valid values only", () => {
    expect(isSeverity("medium")).toBe(true);
    expect(isSeverity("none")).toBe(false); // "none" is only valid for fail-on
    expect(isFailOn("none")).toBe(true);
    expect(isFailOn("critical")).toBe(false);
  });
});

describe("checkLevels", () => {
  it.each([
    ["low", "none"],
    ["low", "low"],
    ["medium", "high"],
    ["high", "high"],
    ["high", "none"],
  ] as const)("accepts min-severity %s with fail-on %s", (minSeverity, failOn) => {
    expect(checkLevels(minSeverity, failOn)).toBeUndefined();
  });

  it("rejects failing on findings that are not shown", () => {
    expect(checkLevels("medium", "low")).toBe(
      'fail-on "low" is below min-severity "medium": LogPilot would fail on findings it does not show; ' +
        'use a fail-on level of "medium" or higher, or "none"',
    );
  });
});
