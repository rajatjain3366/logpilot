// Static guards: which modules can write files.
// - src/fix-write.ts is the ONLY module that writes source files (for `logpilot fix`, after the
//   user's "y"); src/cli.ts writes only the --output report (and refuses .js/.ts paths).
// - `scan` must stay read-only forever: no module that `scan` uses may import fix-write.ts, not
//   even through other modules.
// If a module ever breaks these rules, these tests fail before any file could be changed.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));

/** Every .ts file under src/, as "src/..." paths with "/". */
function sourceModules(): string[] {
  return readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/${f.split(path.sep).join("/")}`)
    .sort();
}
const code = (module: string) => readFileSync(new URL(`../${module}`, import.meta.url), "utf8");

/** Names of Node.js functions that create, change, move or delete files. */
const WRITE_FUNCTIONS =
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rename|renameSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|copyFile|copyFileSync|cp|cpSync|mkdir|mkdirSync|truncate|truncateSync|open|openSync|chmod|chmodSync|link|linkSync|symlink|symlinkSync|utimes|utimesSync)\b/;

/** What a module imports from "fs", "node:fs" or "fs/promises" (the text between `import` and `from`). */
function fsImports(source: string): string[] {
  return [...source.matchAll(/import\s+([^;]+?)\s+from\s+"(?:node:)?fs(?:\/promises)?"/g)].map((m) => m[1]);
}

/** The src/ modules a module imports directly ("./x.js" -> "src/x.ts"). */
function localImports(module: string): string[] {
  const from = path.posix.dirname(module);
  return [...code(module).matchAll(/from\s+"(\.{1,2}\/[^"]+)\.js"/g)].map((m) => path.posix.join(from, `${m[1]}.ts`));
}

/** Every src/ module reachable from `start` through imports (including `start`). */
function reachable(start: string): Set<string> {
  const seen = new Set<string>();
  const visit = (module: string) => {
    if (seen.has(module)) return;
    seen.add(module);
    for (const imported of localImports(module)) visit(imported);
  };
  visit(start);
  return seen;
}

/** The modules a scan uses: the scanner, the reports and the config file (cli.ts also reaches `fix`). */
const SCAN_ENTRY_POINTS = ["src/scanner.ts", "src/report.ts", "src/report-json.ts", "src/config.ts"];
/** The only modules that may import a file-writing function. */
const MAY_WRITE = new Set(["src/fix-write.ts", "src/cli.ts"]);

describe("which modules can write files", () => {
  it.each(sourceModules().filter((m) => !MAY_WRITE.has(m)))("%s imports no file-writing function", (module) => {
    const source = code(module);
    for (const imported of fsImports(source)) expect([module, imported]).toEqual([module, expect.not.stringMatching(WRITE_FUNCTIONS)]);
    expect(source).not.toMatch(/require\(\s*"(?:node:)?fs/);
    expect(source).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+"(?:node:)?fs/); // fs.writeFileSync(...) via a namespace
  });

  it("no module that `scan` uses can reach fix-write.ts, even through other modules", () => {
    const used = new Set(SCAN_ENTRY_POINTS.flatMap((entry) => [...reachable(entry)]));
    expect(used.size).toBeGreaterThan(10); // the graph was really followed
    expect([...used].filter((m) => m === "src/fix-write.ts")).toEqual([]);
  });

  it("only fix-command.ts (logpilot fix, after the user's y) imports fix-write.ts", () => {
    const importers = sourceModules().filter((m) => localImports(m).includes("src/fix-write.ts"));
    expect(importers).toEqual(["src/fix-command.ts"]);
  });

  it("the guards themselves work", () => {
    expect("{ readFileSync, writeFileSync }").toMatch(WRITE_FUNCTIONS);
    expect("{ chmodSync, lstatSync }").toMatch(WRITE_FUNCTIONS);
    expect(fsImports('import { renameSync } from "node:fs";')).toEqual(["{ renameSync }"]);
    expect([...reachable("src/scanner.ts")]).toContain("src/rules/lp003-fix.ts"); // two imports deep
    expect(fsImports(code("src/fix-write.ts")).join(" ")).toMatch(WRITE_FUNCTIONS); // the writer really is found
  });
});
