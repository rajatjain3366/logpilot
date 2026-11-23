// Runs a program from a test with a time limit (Milestone T: flaky-test watch).
//
// Most CLI and git tests are synchronous (spawnSync). While a synchronous call runs, Vitest's own
// timeout cannot stop the test, so a program that hangs would hang the whole test run. With a time
// limit, the program is stopped and the test fails at once, naming the program, the test and the
// time it took. Slow but finished runs are not failed here; Vitest's testTimeout handles those.

import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { expect } from "vitest";

/** How long one program started by a test may run before it is stopped. */
export const PROGRAM_TIME_LIMIT_MS = 60_000;

/** spawnSync with a time limit; throws a clear error when the program had to be stopped. */
export function runLimited(command: string, args: readonly string[], options: Partial<SpawnSyncOptionsWithStringEncoding> = {}) {
  const started = Date.now();
  const limit = options.timeout ?? PROGRAM_TIME_LIMIT_MS;
  const result = spawnSync(command, args, { encoding: "utf8", ...options, timeout: limit });
  const elapsed = Date.now() - started;
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (timedOut) {
    const test = expect.getState().currentTestName ?? "(no test)";
    const shown = [command, ...args].join(" ").slice(0, 200);
    throw new Error(
      `Stopped after ${(elapsed / 1000).toFixed(1)} s (limit ${limit / 1000} s): "${shown}" in test "${test}". ` +
        "If this happens again, find out why before continuing (for example antivirus scanning temp git repositories).",
    );
  }
  return result;
}
