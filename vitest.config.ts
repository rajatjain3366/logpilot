// Vitest settings. By default Vitest runs every *.test.* and *.spec.* file it finds, which
// would include sample code in test/fixtures/ (input for the scanner that must never run).
// So only our own test files, directly in test/, are tests.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    // Milestone T (flaky-test watch): a test that takes longer than this fails, and Vitest names it
    // with the time it took. Normal tests take well under 5 s; 30 s leaves room for a slow machine.
    // Synchronous tests cannot be stopped by this while they run, so every program a test starts
    // also has its own limit (test/run-limited.ts) and is stopped if it hangs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
