// Tests for test/run-limited.ts: a hanging program is stopped, and the error names it and the test.

import { describe, expect, it } from "vitest";
import { runLimited } from "./run-limited.js";

describe("runLimited (flaky-test watch)", () => {
  it("returns the result of a program that finishes in time", () => {
    const result = runLimited(process.execPath, ["-e", "process.stdout.write('ok')"]);
    expect([result.status, result.stdout]).toEqual([0, "ok"]);
  });

  it("stops a program that runs past its limit and fails clearly, with the program, the test and the time", () => {
    const started = Date.now();
    expect(() => runLimited(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 500 })).toThrow(
      /^Stopped after \d+\.\d s \(limit 0\.5 s\): ".*node.* -e setInterval.*" in test "runLimited \(flaky-test watch\) > stops a program/,
    );
    expect(Date.now() - started).toBeLessThan(10_000); // it really was stopped, not waited for
  });
});
