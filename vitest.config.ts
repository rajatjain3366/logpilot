// Vitest settings. By default Vitest runs every *.test.* and *.spec.* file it finds, which
// would include sample code in test/fixtures/ (input for the scanner that must never run).
// So only our own test files, directly in test/, are tests.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
  },
});
