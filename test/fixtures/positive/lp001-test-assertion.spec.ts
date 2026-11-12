// Positive fixture for LP001 (rule 3): an empty catch around a test assertion that must fail
// the test. expect.unreachable(), expect.fail() and assert.fail() fail a test by throwing;
// the empty catch swallows that too, so the check can never fail. These are always reported
// with severity "high", confidence "high", even with a comment: the comment does not make
// the test correct.

import assert from "node:assert";
import { expect, it } from "vitest";

declare function loadModule(id: string): Promise<unknown>;

it("rejects unknown modules", async () => {
  try {
    await loadModule("virtual:missing");
    expect.unreachable();
  } catch {}
});

it("rejects empty ids", async () => {
  try {
    await loadModule("");
    expect.fail("should have thrown");
  } catch (err) {
    // expected: loading an empty id throws
  }
});

it("rejects relative ids", async () => {
  try {
    await loadModule("./x");
    assert.fail("should have thrown");
  } catch {} // the error is expected
});

// NOT rule 3: the assertion runs later, in a callback, not inside this try. So the comment
// directly above the try applies (rule 1): severity "medium", confidence "medium".
it("schedules a check", () => {
  // scheduling a timer does not throw
  try {
    setTimeout(() => expect.unreachable(), 0);
  } catch {}
});
