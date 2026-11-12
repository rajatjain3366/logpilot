// Negative fixture for LP001 (rule 3): tests that check an expected error correctly.
// Must NOT be reported by any rule.

import { expect, it } from "vitest";

declare function loadModule(id: string): Promise<unknown>;

it("rejects unknown modules", async () => {
  await expect(loadModule("virtual:missing")).rejects.toThrow("not found");
});

// The catch checks the error, so a failing expect.unreachable() also fails this check.
it("rejects empty ids", async () => {
  try {
    await loadModule("");
    expect.unreachable();
  } catch (err) {
    expect((err as Error).message).toContain("empty id");
  }
});
