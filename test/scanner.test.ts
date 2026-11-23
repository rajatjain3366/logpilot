// Tests for the scanner: which files get scanned, which folders are skipped,
// and what happens with bad input. Each run builds a throw-away project in the
// system temp folder (git cannot store a folder named ".git" inside our repo).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_RULES_ON, parseSource, ruleSettings, rulesThatRun } from "../src/analyze.js";
import { isStackOverflow, scanPath } from "../src/scanner.js";

const EMPTY_CATCH = "try { work(); } catch (e) {}\n";
// CHANGED ON PURPOSE (v0.4.3): LP001 is off by default. These tests use empty catches (LP001) to
// see which files were scanned, so they run every rule. The defaults are tested at the end.
const ALL_RULES = { rules: ALL_RULES_ON };
let projectDir: string;

/** Writes `content` to `relativePath` inside the temp project, creating folders as needed. */
function writeProjectFile(relativePath: string, content: string): void {
  const fullPath = path.join(projectDir, relativePath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

beforeAll(() => {
  projectDir = mkdtempSync(path.join(os.tmpdir(), "logpilot-scanner-test-"));

  // Every supported extension, each with one empty catch -> each must be scanned.
  writeProjectFile("src/app.ts", EMPTY_CATCH);
  writeProjectFile("src/view.jsx", "function V() { try { work(); } catch (e) {} return <div />; }\n");
  writeProjectFile("src/esm.mjs", EMPTY_CATCH);
  writeProjectFile("src/common.cjs", EMPTY_CATCH);
  writeProjectFile("src/module.mts", EMPTY_CATCH);
  writeProjectFile("src/common.cts", EMPTY_CATCH);

  // Must be skipped, even though they contain an empty catch.
  writeProjectFile("node_modules/some-lib/index.js", EMPTY_CATCH);
  writeProjectFile("src/node_modules/nested-lib/index.js", EMPTY_CATCH); // skipped at any depth
  writeProjectFile("dist/bundle.js", EMPTY_CATCH);
  writeProjectFile(".git/hooks/pre-commit.js", EMPTY_CATCH);
  writeProjectFile("src/types.d.ts", EMPTY_CATCH); // type declarations, not runtime code
  writeProjectFile("src/notes.md", EMPTY_CATCH); //  not a source file at all
});

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("scanner", () => {
  it("scans every supported extension and skips node_modules, dist, .git, .d.ts and other files", () => {
    const result = scanPath(projectDir, projectDir, ALL_RULES);

    expect(result.filesScanned).toBe(6);
    expect(result.warnings).toEqual([]);
    // Sorted by path, "/" separators on every OS.
    expect(result.findings.map((f) => f.file)).toEqual([
      "src/app.ts",
      "src/common.cjs",
      "src/common.cts",
      "src/esm.mjs",
      "src/module.mts",
      "src/view.jsx",
    ]);
  });

  it("can scan a single file", () => {
    const result = scanPath("src/app.ts", projectDir, ALL_RULES);

    expect(result.filesScanned).toBe(1);
    expect(result.findings).toHaveLength(1);
    // CHANGED ON PURPOSE (v0.4.2): a single file is shown relative to its own folder (was src/app.ts,
    // relative to the folder LogPilot ran in).
    expect(result.findings[0].file).toBe("app.ts");
  });

  it("lists a file's findings from top to bottom, whichever rule found them", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-order-test-"));
    try {
      // Line 1: LP002 (new error drops err). Line 2: LP001 (empty catch).
      writeFileSync(path.join(dir, "order.ts"), 'try { a(); } catch (err) { throw new Error("x"); }\ntry { b(); } catch (e) {}\n');
      const result = scanPath("order.ts", dir, ALL_RULES);

      expect(result.findings.map((f) => [f.line, f.ruleId])).toEqual([
        [1, "LP002"],
        [2, "LP001"],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a clear error when the path does not exist", () => {
    expect(() => scanPath("does-not-exist", projectDir)).toThrow('path "does-not-exist" does not exist');
  });

  it("throws a clear error when a single file is not JavaScript or TypeScript", () => {
    expect(() => scanPath("src/notes.md", projectDir)).toThrow("is not a JavaScript or TypeScript file");
  });

  it("records every skipped folder with its reason, sorted by path", () => {
    const result = scanPath(projectDir, projectDir, ALL_RULES);

    expect(result.skipped).toEqual([
      { path: ".git", kind: "folder", reason: "default-folder", detail: "git internals, never scanned" },
      { path: "dist", kind: "folder", reason: "default-folder", detail: "generated output" },
      { path: "node_modules", kind: "folder", reason: "default-folder", detail: "dependencies, never scanned" },
      { path: "src/node_modules", kind: "folder", reason: "default-folder", detail: "dependencies, never scanned" },
    ]);
  });
});

/** Creates a throw-away project with the given files, runs `body`, then deletes it. */
function withProject(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-selection-test-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, relativePath)), { recursive: true });
      writeFileSync(path.join(dir, relativePath), content);
    }
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("scanner: default folder excludes (Milestone 2)", () => {
  it("does not enter third-party and generated-output folders, but scans docs/ and public/", () => {
    const folders = ["bower_components", "jspm_packages", "vendor", "build", "coverage", ".next", ".nuxt", ".output", ".svelte-kit"];
    const files: Record<string, string> = { "src/app.ts": EMPTY_CATCH, "docs/example.js": EMPTY_CATCH, "public/app.js": EMPTY_CATCH };
    for (const folder of folders) files[`${folder}/lib.js`] = EMPTY_CATCH;

    withProject(files, (dir) => {
      const result = scanPath(dir, dir, ALL_RULES);

      expect(result.findings.map((f) => f.file)).toEqual(["docs/example.js", "public/app.js", "src/app.ts"]);
      expect(result.skipped.map((s) => [s.path, s.kind, s.reason])).toEqual(
        [...folders].sort().map((folder) => [folder, "folder", "default-folder"]),
      );
      expect(result.skipped.find((s) => s.path === "vendor")?.detail).toBe("third-party code");
      expect(result.skipped.find((s) => s.path === "build")?.detail).toBe("generated output");
    });
  });

  it("skips minified and vendored files with their reason, and scans everything with defaultExcludes: false", () => {
    const files = {
      "src/app.js": EMPTY_CATCH,
      "public/jquery.min.js": EMPTY_CATCH,
      "public/bundle.js": "!function(){" + "try{a()}catch(e){}".repeat(100) + "}();\n",
      "lib/vendored.js": "/*! some-lib v2.1.0 | MIT */\n" + EMPTY_CATCH,
      "lib/own.js": "/*!\n * my-project\n * MIT Licensed\n */\n" + EMPTY_CATCH,
      "dist/out.js": EMPTY_CATCH,
      "node_modules/dep/index.js": EMPTY_CATCH,
    };

    withProject(files, (dir) => {
      const result = scanPath(dir, dir, ALL_RULES);

      expect(result.findings.map((f) => f.file)).toEqual(["lib/own.js", "src/app.js"]);
      expect(result.skipped.map((s) => [s.path, s.reason])).toEqual([
        ["dist", "default-folder"],
        ["lib/vendored.js", "vendored-banner"],
        ["node_modules", "default-folder"],
        ["public/bundle.js", "minified-content"],
        ["public/jquery.min.js", "minified-name"],
      ]);

      const everything = scanPath(dir, dir, { ...ALL_RULES, defaultExcludes: false });
      expect([...new Set(everything.findings.map((f) => f.file))]).toEqual([
        "dist/out.js",
        "lib/own.js",
        "lib/vendored.js",
        "public/bundle.js",
        "public/jquery.min.js",
        "src/app.js",
      ]);
      expect(everything.skipped.map((s) => s.path)).toEqual(["node_modules"]); // never scanned
    });
  });

  it("warns about a file with syntax errors, and still reports what it can find in it", () => {
    withProject({ "src/broken.js": "try { a(); } catch (e) {}\nconst = 5;\n", "src/fine.js": "const ok = 1;\n" }, (dir) => {
      const result = scanPath(dir, dir, ALL_RULES);

      expect(result.filesScanned).toBe(2);
      expect(result.findings.map((f) => [f.file, f.line])).toEqual([["src/broken.js", 1]]);
      expect(result.warnings).toEqual([
        {
          type: "syntax-error",
          file: "src/broken.js",
          line: 2,
          // TypeScript reports `const = 5;` as two errors on line 2 (it expects a variable name twice).
          message:
            "src/broken.js: 2 syntax errors (first at line 2: Variable declaration expected.); findings in this file may be incomplete",
        },
      ]);
    });
  });

  it("skips files and folders matching the user's exclude patterns, and warns about unused patterns", () => {
    const files = { "src/app.js": EMPTY_CATCH, "docs/site/theme.js": EMPTY_CATCH, "src/api.generated.js": EMPTY_CATCH };

    withProject(files, (dir) => {
      const result = scanPath(dir, dir, { ...ALL_RULES, exclude: ["docs/**", "**/*.generated.js", "scripts/**"], excludeRoot: dir });

      expect(result.findings.map((f) => f.file)).toEqual(["src/app.js"]);
      expect(result.skipped).toEqual([
        { path: "docs", kind: "folder", reason: "user-exclude", detail: 'your exclude pattern "docs/**"' },
        { path: "src/api.generated.js", kind: "file", reason: "user-exclude", detail: 'your exclude pattern "**/*.generated.js"' },
      ]);
      expect(result.warnings).toEqual([
        {
          type: "unused-exclude",
          message: 'exclude pattern "scripts/**" matched nothing (patterns are relative to .); check the spelling',
        },
      ]);
    });
  });

  it("matches exclude patterns relative to excludeRoot, which defaults to the scanned folder", () => {
    withProject({ "web/docs/a.js": EMPTY_CATCH, "web/src/b.js": EMPTY_CATCH }, (dir) => {
      const fromScannedFolder = scanPath("web", dir, { ...ALL_RULES, exclude: ["docs/**"] });
      const fromProjectRoot = scanPath("web", dir, { ...ALL_RULES, exclude: ["web/docs/**"], excludeRoot: dir });

      // CHANGED ON PURPOSE (v0.4.2): paths are relative to the scanned folder "web" (were web/src/b.js).
      expect(fromScannedFolder.findings.map((f) => f.file)).toEqual(["src/b.js"]);
      expect(fromProjectRoot.findings.map((f) => f.file)).toEqual(["src/b.js"]);
    });
  });

  it("skips a default folder at any depth", () => {
    withProject({ "packages/web/build/out.js": EMPTY_CATCH, "packages/web/src/app.js": EMPTY_CATCH }, (dir) => {
      const result = scanPath(dir, dir, ALL_RULES);

      expect(result.findings.map((f) => f.file)).toEqual(["packages/web/src/app.js"]);
      expect(result.skipped.map((s) => s.path)).toEqual(["packages/web/build"]);
    });
  });
});

// v0.4.3: LP001 is off by default; the config file's "rules" and --enable turn rules on or off.
// CHANGED ON PURPOSE (Milestone T, v0.6.0): "default = proven only". Every rule is "proven" by
// default: it runs, but only findings at levels proven on unseen code are shown (today: LP003 at high
// severity); the others are hidden and counted. This replaces v0.4.3's "LP001 off by default".
describe("scanner: which findings are shown (Milestone T: default = proven only)", () => {
  const LOST_CAUSE = 'try { load(); } catch (err) { throw new Error("load failed"); }\n';
  const route = (status: number) =>
    `const app = require("express")();
app.get("/x", async (req, res) => {
  try { res.json(await load()); } catch (err) { res.status(${status}).json({ message: "no" }); }
});
`;

  it("shows only LP003 at high severity by default, and hides and counts everything else", () => {
    withProject({ "a.js": EMPTY_CATCH, "b.js": LOST_CAUSE, "c.js": route(500), "d.js": route(400) }, (dir) => {
      const result = scanPath(dir, dir);
      expect(result.findings.map((f) => `${f.ruleId} ${f.severity} ${f.file}`)).toEqual(["LP003 high c.js"]);
      expect(result.hiddenNotProven.map((f) => `${f.ruleId} ${f.severity} ${f.file}`)).toEqual(["LP001 medium a.js", "LP002 high b.js", "LP003 low d.js"]);

      const all = scanPath(dir, dir, ALL_RULES);
      expect(all.findings.map((f) => f.file)).toEqual(["a.js", "b.js", "c.js", "d.js"]);
      expect(all.hiddenNotProven).toEqual([]);
    });
  });

  it("combines the default, the config file's rules and --enable, with --enable winning", () => {
    expect(Object.fromEntries(ruleSettings())).toEqual({ LP001: "proven", LP002: "proven", LP003: "proven" });
    expect(Object.fromEntries(ruleSettings({ LP001: "on", LP003: "off" }))).toEqual({ LP001: "on", LP002: "proven", LP003: "off" });
    expect(Object.fromEntries(ruleSettings({ LP002: "off" }, ["LP002"]))).toEqual({ LP001: "proven", LP002: "on", LP003: "proven" }); // the flag wins
    expect([...rulesThatRun(ruleSettings({ LP002: "off" }))].sort()).toEqual(["LP001", "LP003"]);
  });

  it("does not run a rule that is off, and then shows and counts nothing of it", () => {
    withProject({ "b.js": LOST_CAUSE }, (dir) => {
      const result = scanPath(dir, dir, { rules: ruleSettings({ LP002: "off" }) });
      expect([result.findings, result.hiddenNotProven]).toEqual([[], []]);
    });
  });

  it("does not warn that a suppression for a rule that is off matched nothing", () => {
    const suppressed = "try { work(); } catch (e) {} // logpilot-ignore-line LP001 -- optional cache\n";
    const both = 'try { a(); } catch (e) {} // logpilot-ignore-line LP001, LP002 -- reviewed\n';
    withProject({ "a.js": suppressed, "b.js": both }, (dir) => {
      const off = scanPath(dir, dir, { rules: ruleSettings({ LP001: "off" }) });
      expect(off.suppressed).toEqual([]);
      // b.js: LP001 is off, so only LP002 (it runs, and has no finding there) is reported as unused.
      expect(off.warnings.map((w) => w.message)).toEqual([
        "b.js:1: the suppression for LP002 matched no finding on line 1; remove it if it is no longer needed",
      ]);

      // "proven" rules run, so their suppressions work as usual (also for findings that would be hidden).
      const proven = scanPath(dir, dir);
      expect(proven.suppressed.map((s) => s.finding.file)).toEqual(["a.js", "b.js"]);
      expect(proven.hiddenNotProven).toEqual([]);
    });
  });

  it("still warns about a suppression that names an unknown rule or has no reason", () => {
    withProject({ "a.js": "try { work(); } catch (e) {} // logpilot-ignore-line LP001\n" }, (dir) => {
      expect(scanPath(dir, dir).warnings.map((w) => w.type)).toEqual(["invalid-suppression"]);
    });
  });
});

// T2 robustness run (v0.6.0): a large Flow type file nested `<T>` thousands deep. In a .js file,
// TypeScript's parser reads each `<T>` as a JSX element, recursed past the call stack, and the
// whole scan stopped with "Maximum call stack size exceeded" (exit code 2). Now only that file is
// left unchecked, with a warning. The reproduction below is made up: generated nested tags.
describe("scanner: a file too deeply nested for the parser (T2 robustness run)", () => {
  // One tag per line: a single very long line would be skipped as minified before parsing.
  const DEEP = "const x = " + "<T>\n".repeat(20_000) + ";\n";

  it("precondition: the generated file really overflows the parser's call stack", () => {
    expect(() => parseSource("deep.js", DEEP)).toThrow(/call stack/i);
  });

  it("skips only that file with a warning, checks every other file, and gives the same result every time", () => {
    withProject({ "a.js": EMPTY_CATCH, "deep.js": DEEP, "z.js": EMPTY_CATCH }, (dir) => {
      const result = scanPath(dir, dir, ALL_RULES);

      expect(result.filesScanned).toBe(2);
      expect(result.findings.map((f) => f.file)).toEqual(["a.js", "z.js"]); // the file after it too
      expect(result.warnings).toEqual([
        {
          type: "too-deeply-nested",
          file: "deep.js",
          message: "deep.js: not checked: its code is nested too deeply for the parser (the call stack ran out); no findings are reported for it",
        },
      ]);
      expect(scanPath(dir, dir, ALL_RULES)).toEqual(result);
    });
  });

  it("treats only a call-stack overflow this way; any other error is a LogPilot bug and still stops the scan", () => {
    expect(isStackOverflow(new RangeError("Maximum call stack size exceeded"))).toBe(true);
    expect(isStackOverflow(new RangeError("Invalid array length"))).toBe(false);
    expect(isStackOverflow(new TypeError("Maximum call stack size exceeded"))).toBe(false);
    expect(isStackOverflow("Maximum call stack size exceeded")).toBe(false);
  });
});
