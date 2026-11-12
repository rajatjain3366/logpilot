// A static guard: the modules that make and check fix previews must not be able to write files.
// LogPilot's only write is the --output report in cli.ts (which refuses .js/.ts paths). If one of
// these modules ever imports a write function, this test fails before any file could be changed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const READ_ONLY_MODULES = [
  "src/analyze.ts",
  "src/fix-edits.ts",
  "src/fix-validate.ts",
  "src/fixes.ts",
  "src/rules/lp003-fix.ts",
  "src/scanner.ts",
  "src/report.ts",
];

/** Names of Node.js functions that create, change, move or delete files. */
const WRITE_FUNCTIONS =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rename|renameSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|copyFile|copyFileSync|cp|cpSync|mkdir|mkdirSync|truncate|truncateSync|open|openSync)\b/;

describe("fix previews never write files", () => {
  it.each(READ_ONLY_MODULES)("%s imports no file-writing function", (file) => {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const fsImports = [...code.matchAll(/import\s+([^;]+?)\s+from\s+"(?:node:)?fs(?:\/promises)?"/g)].map((m) => m[1]);
    for (const imported of fsImports) expect([file, imported]).toEqual([file, expect.not.stringMatching(WRITE_FUNCTIONS)]);
    expect(code).not.toMatch(/require\(\s*"(?:node:)?fs/);
  });

  it("the guard itself catches a write import", () => {
    expect('{ readFileSync, writeFileSync }').toMatch(WRITE_FUNCTIONS);
  });
});
