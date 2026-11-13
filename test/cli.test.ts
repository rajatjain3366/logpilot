// End-to-end tests: run the real, built CLI (node dist/cli.js ...) the way a user
// would, and check its output and exit codes. `npm test` builds dist/ first.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = path.join(projectRoot, "dist", "cli.js");
const fixturesDir = path.join(projectRoot, "test", "fixtures");

/** Runs `node dist/cli.js <args>` and captures what it printed and its exit code. */
function runCli(args: string[], cwd: string = projectRoot) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: "utf8" });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Fingerprint of every file in a folder: content hash, size and last-modified time. */
function fingerprintFolder(dir: string): Record<string, string> {
  const fingerprint: Record<string, string> = {};
  for (const relativePath of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const fullPath = path.join(dir, relativePath);
    const stats = statSync(fullPath);
    if (stats.isFile()) {
      const hash = createHash("sha256").update(readFileSync(fullPath)).digest("hex");
      fingerprint[relativePath] = `${hash} ${stats.size} ${stats.mtimeMs}`;
    }
  }
  return fingerprint;
}

beforeAll(() => {
  if (!existsSync(cliPath)) {
    throw new Error(`${cliPath} not found. Run "npm run build" first (or use "npm test", which builds).`);
  }
});

describe("CLI: help, version and usage errors", () => {
  it.each(["--help", "-h"])("%s prints usage and exits 0", (flag) => {
    const { exitCode, stdout, stderr } = runCli([flag]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("logpilot scan [path]");
    expect(stderr).toBe("");
  });

  it.each(["--version", "-v"])("%s prints the package.json version and exits 0", (flag) => {
    const { version } = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const { exitCode, stdout } = runCli([flag]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${version}\n`);
  });

  it("with no command, prints help to stderr and exits 2", () => {
    const { exitCode, stdout, stderr } = runCli([]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("Error: no command given.");
    expect(stderr).toContain("Usage:");
  });

  it("rejects an unknown command with exit 2", () => {
    const { exitCode, stderr } = runCli(["lint", "."]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('Error: unknown command "lint"');
    expect(stderr).toContain('Run "logpilot --help" for usage.');
  });

  it("rejects an unknown flag with exit 2", () => {
    const { exitCode, stderr } = runCli(["scan", "--fix"]);

    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/^Error: .*--fix/);
  });

  it("rejects more than one path with exit 2", () => {
    const { exitCode, stderr } = runCli(["scan", "a", "b"]);

    expect(exitCode).toBe(2);
    expect(stderr).toContain('"scan" takes one path');
  });
});

// CHANGED ON PURPOSE (v0.4.2): the tests that scan this repository's own fixtures pass --no-config.
// CHANGED ON PURPOSE (v0.4.3): they also pass --enable LP001 (off by default), so LP001 is still
// checked end to end on the fixtures.
// LogPilot's logpilot.config.json (at the repository root, so LogPilot can scan itself) excludes
// test/fixtures/**, and these tests are about what the rules report, not about that config.
describe("CLI: scan", () => {
  it("exits 0 with '0 findings' when the code handles its errors (all rules run)", () => {
    const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", "test/fixtures/negative", "--no-config"]);

    expect(exitCode).toBe(0);
    // 7 files written for LP001 + 3 for LP002 + 1 for LP003 (added in Milestone 2.5); no rule may
    // report any of them.
    expect(stdout).toBe("Scanned 11 files, 0 findings\n");
    expect(stderr).toBe("");
  });

  it("prints every finding when there are problems, and exits 0 by default (warning-only)", () => {
    const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", "test/fixtures/positive", "--no-config"]);

    // EXIT CODE CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none", so findings alone
    // exit 0. Exit code 1 with --fail-on is tested in "CLI: severity filtering and --fail-on".
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    // CHANGED ON PURPOSE (v0.4.2): paths are relative to the scanned folder (was test/fixtures/positive/...).
    // CHANGED ON PURPOSE (v0.4.3): this finding has the same pattern as empty-catch-in-component.tsx:10,
    // so it is listed (indented) under that one instead of being printed in full.
    expect(stdout).toContain("\n    empty-catch.ts:9:5\n");
    expect(stdout).toContain("  LP001 empty-catch | severity: medium | confidence: high\n"); // the default
    expect(stdout).toContain("  LP001 empty-catch | severity: high | confidence: high\n"); // with positive evidence
    expect(stdout.startsWith("comment-only-catch.js:7:5\n")).toBe(true); // the first file, sorted by path
    // CHANGED ON PURPOSE (Milestone 2.5): a comment lowers only confidence (severity was "low").
    expect(stdout).toContain("  LP001 empty-catch | severity: medium | confidence: medium\n"); // comment-only (rule 1)
    // CHANGED ON PURPOSE (v0.4.3): checked in --verbose output, where every finding is shown in full.
    const verbose = runCli(["scan", "--enable", "LP001", "test/fixtures/positive", "--no-config", "--verbose"]).stdout;
    expect(verbose).toContain("\nempty-catch.ts:9:5\n");
    expect(verbose).toContain("    9 |   } catch (err) {}\n"); // gutter is as wide as the largest line number shown
    expect(stdout).toContain("\nlp002-message-only.js:10:5\n");
    expect(stdout).toContain("  LP002 lost-error-cause | severity: medium | confidence: high\n");
    expect(stdout).toContain("  Why: ");
    expect(stdout).toContain("  Fix: ");
    // LP001: 6 (original) + 4 (test-assertion) + 4 (unexplained-comments) + 3 (inside-error-handling-lost)
    //        + 6 (guarded-swallow) + 10 (tool-directives) + 6 (test-assertion-more) = 39
    // LP002: 4 (lost-cause) + 5 (message-only) + 2 (options-mistake) + 3 (no-binding) = 14
    // LP003: 8 (error-responses) + 3 (error-middleware) + 3 (response-helpers) = 14
    // (Milestone 2.5 added the tool-directives, test-assertion-more and 3 LP003 fixtures: 11 -> 16 files.)
    // CHANGED ON PURPOSE (v0.4.3): "in 49 patterns" (repeated patterns are listed under their first finding).
    expect(stdout.endsWith("Scanned 16 files, 67 findings in 49 patterns (LP001: 39, LP002: 14, LP003: 14)\n")).toBe(true);
  });

  it("scans the whole fixtures folder (edge + negative + positive)", () => {
    const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", "test/fixtures", "--no-config"]);

    // EXIT CODE CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none" (was 1 with findings).
    expect(exitCode).toBe(0);
    // LP001: 39 (positive) + 4 (explained-ignore) + 2 (inside-error-handling) + 6 (guard-not-applicable)
    //        + 3 (test-context-assertions) = 54
    // LP002: 14 (positive) + 2 (logged) + 3 (guarded) + 1 (commented) + 1 (nested) + 2 (no-binding-combined) = 23
    // LP003: 14 (positive) + 4 (client-errors-and-shapes) + 1 (error-middleware-shape) = 19
    //        + 17 in fix/ (console-cases 12, axios 3, style 1, typescript 1) = 36
    // (Milestone 2.5 added 3 LP001 fixtures and 6 LP003 fixtures: 29 -> 38 files.)
    // CHANGED ON PURPOSE (Milestone 3): 4 fix-preview fixtures in test/fixtures/fix/: 38 -> 42 files,
    // 17 more LP003 findings, and no LP001 or LP002 finding.
    // CHANGED ON PURPOSE (Milestone 3, Checkpoint 3): fix/loggers/ adds 7 fixtures and 3 logger modules
    // (42 -> 52 files) and one LP003 finding per fixture (36 -> 43).
    // CHANGED ON PURPOSE (v0.4.1): fix/passwords/ adds 3 handler files (8 + 4 + 1 LP003 findings) and
    // 3 model modules (no findings): 52 -> 58 files, LP003 43 -> 56.
    // CHANGED ON PURPOSE (v0.4.3): "in 109 patterns" (11 patterns repeat; LP003 is never grouped).
    expect(stdout.endsWith("Scanned 58 files, 133 findings in 109 patterns (LP001: 54, LP002: 23, LP003: 56)\n")).toBe(true);
  });

  it("scans a single file", () => {
    const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", "test/fixtures/positive/empty-catch.ts", "--no-config"]);

    // EXIT CODE CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none" (was 1 with findings).
    expect(exitCode).toBe(0);
    // CHANGED ON PURPOSE (v0.4.2): the file has no Express handler, so the summary says that LP003
    // had nothing to check; and a single file is shown relative to its own folder.
    expect(
      stdout.endsWith("Scanned 1 file, 3 findings (LP001: 3)\nNo Express handlers found: LP003 and fix previews only check Express apps.\n"),
    ).toBe(true);
    expect(stdout.startsWith("empty-catch.ts:9:5\n")).toBe(true);
  });

  it("scans the current folder when no path is given", () => {
    const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", "--no-config"], path.join(fixturesDir, "negative"));

    expect(exitCode).toBe(0);
    expect(stdout).toBe("Scanned 11 files, 0 findings\n"); // 10 + LP003's negative fixture (Milestone 2.5)
  });

  it("exits 2 with a clear error when the path does not exist", () => {
    const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", "does-not-exist"]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe('Error: path "does-not-exist" does not exist\n');
  });

  it("does not create, delete or modify any file it scans", () => {
    const before = fingerprintFolder(fixturesDir);
    // CHANGED ON PURPOSE (Milestone 2): findings alone now exit 0, so "--fail-on low" is passed to
    // keep using exit code 1 as proof that the scan really ran and found the positives.
    const { exitCode } = runCli(["scan", "--enable", "LP001", "test/fixtures", "--no-config", "--fail-on", "low"]);
    const after = fingerprintFolder(fixturesDir);

    expect(exitCode).toBe(1); // the scan really ran and found the positives
    // CHANGED ON PURPOSE (Milestone 3): 4 fix-preview fixtures added in test/fixtures/fix/.
    // CHANGED ON PURPOSE (Milestone 3, Checkpoint 3): 10 more in test/fixtures/fix/loggers/.
    // CHANGED ON PURPOSE (v0.4.1): 6 more in test/fixtures/fix/passwords/.
    expect(Object.keys(before)).toHaveLength(58); // 29 + 3 LP001 and 6 LP003 (Milestone 2.5) + 14 fix (Milestone 3) + 6 (v0.4.1)
    expect(after).toEqual(before);
  });

  it("does not create, delete or modify any file with --fix-preview either (fixes are only shown)", () => {
    const before = fingerprintFolder(fixturesDir);
    const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", "test/fixtures", "--no-config", "--fix-preview", "--fail-on", "low"]);
    const after = fingerprintFolder(fixturesDir);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Proposed fix (preview only, not applied)"); // fixes really were made
    expect(stdout).toMatch(/Fix previews \(LP003 only\): [1-9]\d* available/);
    expect(after).toEqual(before);
  });
});

const EMPTY_CATCH = "try { work(); } catch (e) {}\n";

/**
 * Creates a throw-away project in the system temp folder, runs `body` with its path, then deletes it.
 * The temp folder is outside any git repository, so config files are only looked for in the
 * scanned folder itself.
 */
function withProject(files: Record<string, string>, body: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-cli-test-"));
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

// CHANGED ON PURPOSE (v0.4.3): LP001 is off by default; these tests use empty catches (LP001) as
// findings to check other behaviour, so their scans pass --enable LP001.
describe("CLI: what was not scanned (Milestone 2)", () => {
  const files = { "src/app.js": EMPTY_CATCH, "node_modules/lib/index.js": EMPTY_CATCH, "build/out.js": EMPTY_CATCH };

  it("says in the summary how much was not scanned, and why", () => {
    withProject(files, (dir) => {
      const { stdout } = runCli(["scan", "--enable", "LP001", "."], dir);

      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
      expect(stdout).toContain(
        "Not scanned: 2 folders (default folders: 2). Run with --show-skipped to list them.\n",
      );
    });
  });

  it("--show-skipped lists every skipped folder with its reason", () => {
    withProject(files, (dir) => {
      const { stdout, stderr } = runCli(["scan", "--enable", "LP001", ".", "--show-skipped"], dir);

      expect(stderr).toBe("");
      expect(stdout.endsWith(
        [
          "Not scanned (0 files, 2 folders):",
          "  folder  build  (generated output)",
          "  folder  node_modules  (dependencies, never scanned)",
          "",
        ].join("\n"),
      )).toBe(true);
    });
  });

  it("documents --show-skipped and --no-default-excludes in --help", () => {
    const { stdout } = runCli(["--help"]);

    expect(stdout).toContain("--show-skipped");
    expect(stdout).toContain("--no-default-excludes");
  });

  it("prints a syntax-error warning to stderr, without changing the exit code", () => {
    withProject({ "broken.js": "let x = ;\n" }, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", "."], dir);

      expect(exitCode).toBe(0); // no findings: a syntax error alone does not fail the scan
      expect(stderr).toBe(
        "Warning: broken.js: 1 syntax error (first at line 1: Expression expected.); " +
          "findings in this file may be incomplete\n",
      );
      // CHANGED ON PURPOSE (v0.4.2): the "No Express handlers found" line.
      expect(stdout).toBe(
        "Scanned 1 file, 0 findings\n1 file had syntax errors; findings in it may be incomplete (see the warnings).\n" +
          "No Express handlers found: LP003 and fix previews only check Express apps.\n",
      );
    });
  });

  it("uses logpilot.config.json from the scanned folder, and says so in the summary", () => {
    withProject({ ...files, "logpilot.config.json": '{ "defaultExcludes": false }' }, (dir) => {
      const { stdout } = runCli(["scan", "--enable", "LP001", "."], dir);

      // CHANGED ON PURPOSE (v0.4.3): the two identical empty catches are one pattern.
      expect(stdout).toContain("Scanned 2 files, 2 findings in 1 pattern (LP001: 2)\n"); // build/ is scanned now
      expect(stdout).toContain("Config file: logpilot.config.json\n");
    });
  });

  it("stops with exit code 2 and a clear message when the config file is invalid", () => {
    withProject({ ...files, "logpilot.config.json": '{ "excludes": ["docs/**"] }' }, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", "."], dir);

      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      // CHANGED ON PURPOSE (v0.4.3): "rules" is a known setting now.
      expect(stderr).toBe(
        'Error: logpilot.config.json: unknown setting "excludes" (known settings: exclude, defaultExcludes, minSeverity, failOn, rules)\n',
      );
    });
  });

  it("--config uses the given file; --no-config ignores config files; both together is an error", () => {
    withProject({ ...files, "logpilot.config.json": "{ broken", "settings/strict.json": '{ "defaultExcludes": false }' }, (dir) => {
      // EXIT CODES CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none", so these scans with
      // findings exit 0 (was 1). What matters here is that they are not 2, the code for a broken config.
      const withConfig = runCli(["scan", "--enable", "LP001", ".", "--config", "settings/strict.json"], dir);
      expect(withConfig.exitCode).toBe(0);
      expect(withConfig.stdout).toContain("Config file: settings/strict.json\n");

      const noConfig = runCli(["scan", "--enable", "LP001", ".", "--no-config"], dir);
      expect(noConfig.exitCode).toBe(0); // the broken logpilot.config.json was not read
      expect(noConfig.stdout).not.toContain("Config file:");

      const missing = runCli(["scan", "--enable", "LP001", ".", "--config", "nope.json"], dir);
      expect(missing.exitCode).toBe(2);
      expect(missing.stderr).toBe('Error: config file "nope.json" does not exist\n');

      const both = runCli(["scan", "--enable", "LP001", ".", "--config", "settings/strict.json", "--no-config"], dir);
      expect(both.exitCode).toBe(2);
      expect(both.stderr).toContain("use either --config or --no-config, not both");
    });
  });

  it("applies exclude patterns from the config file (relative to its folder) and from --exclude", () => {
    const project = {
      "logpilot.config.json": '{ "exclude": ["packages/web/docs/**"] }',
      "packages/web/docs/theme.js": EMPTY_CATCH,
      "packages/web/scripts/release.js": EMPTY_CATCH,
      "packages/web/src/app.js": EMPTY_CATCH,
      ".git/HEAD": "ref: refs/heads/main\n",
    };
    withProject(project, (dir) => {
      // Scanning a subfolder: the config file at the repository root still applies, relative to its own folder.
      const { stdout, stderr } = runCli(["scan", "--enable", "LP001", "packages/web", "--exclude", "packages/web/scripts/**"], dir);

      expect(stderr).toBe("");
      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
      expect(stdout).toContain("Not scanned: 2 folders (your exclude patterns: 2).");
      // CHANGED ON PURPOSE (v0.4.2): paths are relative to the scanned folder (packages/web), also
      // the config file's (was "logpilot.config.json", relative to the folder LogPilot ran in).
      expect(stdout).toContain("Config file: ../../logpilot.config.json\n");
      expect(stdout).toMatch(/^src\/app\.js:1:17$/m); // was packages/web/src/app.js
    });
  });

  it("warns about an exclude pattern that matched nothing, and rejects an invalid one with exit code 2", () => {
    withProject(files, (dir) => {
      const unused = runCli(["scan", "--enable", "LP001", ".", "--exclude", "doc/**"], dir);
      expect(unused.stderr).toBe('Warning: exclude pattern "doc/**" matched nothing (patterns are relative to .); check the spelling\n');

      const invalid = runCli(["scan", "--enable", "LP001", ".", "--exclude", "!src/app.js"], dir);
      expect(invalid.exitCode).toBe(2);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toContain('Error: --exclude "!src/app.js": patterns that start with "!" (exceptions) are not supported');
    });
  });

  it("ignores a stray config file above the repository root", () => {
    withProject({ "logpilot.config.json": "{ broken", "repo/.git/HEAD": "ref: refs/heads/main\n", "repo/src/app.js": EMPTY_CATCH }, (dir) => {
      const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", "."], path.join(dir, "repo"));

      // EXIT CODE CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none" (was 1 with findings).
      // It must not be 2, which would mean the broken file above the repository was read.
      expect(exitCode).toBe(0); // the broken file above the repository was not read
      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
    });
  });

  it("suppresses findings with logpilot-ignore comments, counts them, and warns about bad ones", () => {
    const code = [
      "try { a(); }",
      "// logpilot-ignore-next-line LP001 -- the cache is optional",
      "catch {}",
      "try { b(); }",
      "// logpilot-ignore-next-line LP001",
      "catch {}",
    ].join("\n");
    withProject({ "src/cache.js": code }, (dir) => {
      const { stdout, stderr } = runCli(["scan", "--enable", "LP001", "."], dir);

      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n1 finding was suppressed by logpilot-ignore comments.\n");
      expect(stdout).toContain("src/cache.js:6:1\n"); // the one without a reason is still reported
      expect(stderr).toBe(
        'Warning: src/cache.js:5: this suppression has no reason; add "-- why" after the rule ID (it was not applied)\n',
      );
    });
  });

  it("--no-default-excludes scans build output and minified files, but never node_modules", () => {
    withProject({ ...files, "public/app.min.js": EMPTY_CATCH }, (dir) => {
      const { stdout } = runCli(["scan", "--enable", "LP001", ".", "--no-default-excludes"], dir);

      // CHANGED ON PURPOSE (v0.4.3): the three identical empty catches are one pattern.
      expect(stdout).toContain("Scanned 3 files, 3 findings in 1 pattern (LP001: 3)\n");
      expect(stdout).toContain("Not scanned: 1 folder (default folders: 1).");
    });
  });
});

// CHANGED ON PURPOSE (v0.4.3): LP001 is off by default; these tests use empty catches (LP001) as
// findings to check other behaviour, so their scans pass --enable LP001.
describe("CLI: severity filtering and --fail-on (Milestone 2)", () => {
  // One finding of each severity: medium (plain empty catch), low (inside a catch whose error is
  // rethrown), high (an existence check runs before the try).
  // CHANGED ON PURPOSE (Milestone 2.5): line 3 used to get "low" from a comment after the catch;
  // a comment no longer lowers severity, so the low finding now comes from the nested catch.
  const levels = [
    "const fs = require('fs');",
    "try { a(); } catch {}",
    "try { b(); } catch (e) { try { c(); } catch {} throw e; }",
    "if (fs.existsSync(f)) { try { read(f); } catch {} }",
  ].join("\n");
  const project = { "levels.js": levels, "medium-only.js": "try { a(); } catch {}\n" };

  it("shows every severity and exits 0 by default (warning-only)", () => {
    withProject(project, (dir) => {
      const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", "levels.js"], dir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Scanned 1 file, 3 findings (LP001: 3)\n");
    });
  });

  it("--min-severity hides lower findings and says how many", () => {
    withProject(project, (dir) => {
      const medium = runCli(["scan", "--enable", "LP001", "levels.js", "--min-severity", "medium"], dir);
      expect(medium.stdout).toContain("Scanned 1 file, 2 findings (LP001: 2)\n");
      expect(medium.stdout).toContain("1 finding below medium severity is not shown (--min-severity).\n");
      expect(medium.stdout).not.toContain("levels.js:3:");

      const high = runCli(["scan", "--enable", "LP001", "levels.js", "--min-severity", "high"], dir);
      expect(high.stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
      expect(high.stdout).toContain("2 findings below high severity are not shown (--min-severity).\n");
    });
  });

  it("--fail-on exits 1 only when a finding is at or above the level", () => {
    withProject(project, (dir) => {
      expect(runCli(["scan", "--enable", "LP001", "levels.js", "--fail-on", "high"], dir).exitCode).toBe(1);
      expect(runCli(["scan", "--enable", "LP001", "medium-only.js", "--fail-on", "high"], dir).exitCode).toBe(0);
      expect(runCli(["scan", "--enable", "LP001", "medium-only.js", "--fail-on", "medium"], dir).exitCode).toBe(1);
      expect(runCli(["scan", "--enable", "LP001", "medium-only.js", "--fail-on", "none"], dir).exitCode).toBe(0);
    });
  });

  it("refuses to fail on findings it does not show, and rejects unknown levels (exit code 2)", () => {
    withProject(project, (dir) => {
      const hidden = runCli(["scan", "--enable", "LP001", ".", "--min-severity", "high", "--fail-on", "medium"], dir);
      expect(hidden.exitCode).toBe(2);
      expect(hidden.stdout).toBe("");
      expect(hidden.stderr).toContain('Error: fail-on "medium" is below min-severity "high"');

      const unknown = runCli(["scan", "--enable", "LP001", ".", "--fail-on", "always"], dir);
      expect(unknown.exitCode).toBe(2);
      expect(unknown.stderr).toContain('--fail-on must be one of none, low, medium, high (got "always")');
    });
  });

  it("reads minSeverity and failOn from the config file; command-line options win", () => {
    withProject({ ...project, "logpilot.config.json": '{ "minSeverity": "medium", "failOn": "high" }' }, (dir) => {
      const fromConfig = runCli(["scan", "--enable", "LP001", "levels.js"], dir);
      expect(fromConfig.exitCode).toBe(1); // a high finding, failOn "high"
      expect(fromConfig.stdout).toContain("1 finding below medium severity is not shown");

      const overridden = runCli(["scan", "--enable", "LP001", "levels.js", "--fail-on", "none", "--min-severity", "low"], dir);
      expect(overridden.exitCode).toBe(0);
      expect(overridden.stdout).toContain("Scanned 1 file, 3 findings (LP001: 3)\n");
    });
  });

  it("documents the new options and the honest note about severity in --help", () => {
    const { stdout } = runCli(["--help"]);

    expect(stdout).toContain("--min-severity <level>");
    expect(stdout).toContain("--fail-on <level>");
    expect(stdout).toContain("Severity is not reliable yet");
  });
});

// CHANGED ON PURPOSE (v0.4.3): LP001 is off by default; these tests use empty catches (LP001) as
// findings to check other behaviour, so their scans pass --enable LP001.
describe("CLI: JSON output and --output (Milestone 2)", () => {
  const project = {
    "src/app.js": EMPTY_CATCH,
    "src/broken.js": "let x = ;\n",
    "src/kept.js": ["// logpilot-ignore-next-line LP001 -- the cache is optional", "try { a(); } catch {}", ""].join("\n"),
    "dist/out.js": EMPTY_CATCH,
  };

  it("prints only JSON on stdout: warnings go into the JSON, not to stderr", () => {
    withProject(project, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", ".", "--format", "json"], dir);

      expect(exitCode).toBe(0);
      expect(stderr).toBe(""); // the syntax-error warning is in the JSON instead
      const report = JSON.parse(stdout);
      // CHANGED ON PURPOSE (Milestone 3): schema version 2 adds fix, config.fixPreview and summary.fixes.
      // CHANGED ON PURPOSE (v0.4.2): schema version 3: paths are relative to the scanned folder.
      expect(report.schemaVersion).toBe(3);
      // CHANGED ON PURPOSE (Milestone 2.5): LP001 changed behaviour, so its version went from 1 to 2.
      // CHANGED ON PURPOSE (Milestone 2.5): LP003 was added.
      // CHANGED ON PURPOSE (Milestone 2.5): LP003 case E severity went from medium to low: version 1 -> 2.
      // CHANGED ON PURPOSE (Milestone 3): LP003's suggestion logs req.method and req.route?.path instead
      // of req.path: version 2 -> 3.
      // CHANGED ON PURPOSE (v0.4.3): LP001's suggestion text changed in v0.4.2: version 2 -> 3
      // (detection unchanged). Each rule now says whether it ran (`enabled`).
      expect(report.rules).toEqual([
        { id: "LP001", name: "empty-catch", version: 3, enabled: true }, // --enable LP001
        { id: "LP002", name: "lost-error-cause", version: 1, enabled: true },
        { id: "LP003", name: "unlogged-error-response", version: 3, enabled: true },
      ]);
      expect(report.config.rules).toEqual({ LP001: "on", LP002: "on", LP003: "on" });
      expect(report.summary.filesScanned).toBe(3);
      expect(report.findings.map((f: { file: string; line: number }) => `${f.file}:${f.line}`)).toEqual(["src/app.js:1"]);
      expect(report.suppressed[0].reason).toBe("the cache is optional");
      expect(report.skipped).toEqual([{ path: "dist", kind: "folder", reason: "default-folder", detail: "generated output" }]);
      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0]).toMatchObject({ type: "syntax-error", file: "src/broken.js", line: 1 });
    });
  });

  it("gives byte-identical JSON on every run", () => {
    withProject(project, (dir) => {
      const first = runCli(["scan", "--enable", "LP001", ".", "--format", "json"], dir).stdout;
      const second = runCli(["scan", "--enable", "LP001", ".", "--format", "json"], dir).stdout;

      expect(first.length).toBeGreaterThan(0);
      expect(second).toBe(first);
    });
  });

  it("applies --min-severity and --fail-on, and records the exit code in the summary", () => {
    withProject(project, (dir) => {
      const { exitCode, stdout } = runCli(["scan", "--enable", "LP001", ".", "--format", "json", "--fail-on", "medium"], dir);

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout).summary.exitCode).toBe(1);
      expect(JSON.parse(stdout).config.failOn).toBe("medium");

      const high = JSON.parse(runCli(["scan", "--enable", "LP001", ".", "--format", "json", "--min-severity", "high"], dir).stdout);
      expect(high.findings).toEqual([]);
      expect(high.summary.hiddenBelowMinSeverity).toBe(1);
    });
  });

  it("--output writes the report to a file and prints nothing", () => {
    withProject(project, (dir) => {
      const expected = runCli(["scan", "--enable", "LP001", ".", "--format", "json"], dir).stdout;
      const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", ".", "--format", "json", "--output", "report.json"], dir);

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(readFileSync(path.join(dir, "report.json"), "utf8")).toBe(expected);

      // Text reports can be written to a file too; warnings still go to the screen (stderr).
      const text = runCli(["scan", "--enable", "LP001", ".", "--output", "report.txt"], dir);
      expect(text.stdout).toBe("");
      expect(text.stderr).toContain("Warning: src/broken.js: 1 syntax error");
      expect(readFileSync(path.join(dir, "report.txt"), "utf8")).toContain("Scanned 3 files, 1 finding (LP001: 1)\n");
    });
  });

  it("refuses to write the report into a JavaScript or TypeScript file (exit code 2)", () => {
    withProject(project, (dir) => {
      for (const target of ["src/app.js", "src/new.ts", "src/App.TSX"]) {
        const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", ".", "--output", target], dir);
        expect(exitCode).toBe(2);
        expect(stdout).toBe("");
        expect(stderr).toContain(`--output "${target}": refusing to write a report into a JavaScript or TypeScript file`);
      }
      expect(readFileSync(path.join(dir, "src/app.js"), "utf8")).toBe(EMPTY_CATCH); // untouched
      expect(existsSync(path.join(dir, "src/new.ts"))).toBe(false);
    });
  });

  it("rejects an unknown --format, and reports a file it cannot write (exit code 2)", () => {
    withProject(project, (dir) => {
      const xml = runCli(["scan", "--enable", "LP001", ".", "--format", "xml"], dir);
      expect(xml.exitCode).toBe(2);
      expect(xml.stderr).toContain('--format must be text or json (got "xml")');

      const noFolder = runCli(["scan", "--enable", "LP001", ".", "--output", "missing-folder/report.json"], dir);
      expect(noFolder.exitCode).toBe(2);
      expect(noFolder.stderr).toContain('Error: could not write the report to "missing-folder/report.json"');
    });
  });
});

describe("CLI: --fix-preview (Milestone 3)", () => {
  const HANDLER = [
    'const express = require("express");',
    "const app = express();",
    'app.get("/users/:id", async (req, res) => {',
    "  try {",
    "    res.json(await load(req.params.id));",
    "  } catch (err) {",
    '    res.status(500).json({ message: "Server error" });',
    "  }",
    "});",
    "",
  ].join("\n");

  it("shows the proposed fix as a diff under the finding, and counts fixes in the summary", () => {
    withProject({ "src/app.js": HANDLER }, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", ".", "--fix-preview"], dir);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain(
        [
          "  Proposed fix (preview only, not applied): Log the caught error with console.error just before the",
          "    error response on line 7.",
          "    Logger: console.error (confidence low: no logger was found in this file, so the fix uses",
          "      console.error, which every Node.js program has)",
          "    --- a/src/app.js",
          "    +++ b/src/app.js",
          "    @@ -4,6 +4,7 @@",
          "       try {",
          "         res.json(await load(req.params.id));",
          "       } catch (err) {",
          '    +    console.error("Request failed:", { method: req.method, route: req.route?.path }, err);',
          '         res.status(500).json({ message: "Server error" });',
          "       }",
          "     });",
          "  Checked: the fixed code parses, the fix only adds code, it logs nothing but the error, req.method",
          "           and req.route?.path, and after it this finding is gone and no other finding changes.",
        ].join("\n"),
      );
      // CHANGED ON PURPOSE (Milestone 3, Checkpoint 3): one summary line over 100 columns became two.
      expect(stdout).toContain(
        "Fix previews (LP003 only): 1 available, 0 not available.\nNo file was changed: apply a fix yourself after reviewing it.",
      );
    });
  });

  it("shows the reason when there is no fix, and shows nothing about fixes without the flag", () => {
    const clientError = HANDLER.replace("res.status(500)", "res.status(401)");
    withProject({ "src/app.js": clientError }, (dir) => {
      const withFlag = runCli(["scan", ".", "--fix-preview"], dir);
      expect(withFlag.stdout).toContain("  No fix proposed: No fix for a 4xx answer (case E).");
      expect(withFlag.stdout).toContain("Fix previews (LP003 only): 0 available, 1 not available.");

      const withoutFlag = runCli(["scan", "."], dir);
      expect(withoutFlag.stdout).not.toMatch(/fix proposed|Proposed fix|Fix previews/i);
    });
  });

  // CHANGED ON PURPOSE (Milestone 3, Checkpoint 3): --fix-preview with --format json was refused until
  // schema version 2 existed. Now the JSON report includes each fix.
  it("includes the fixes in the JSON report, with their edits and diff", () => {
    withProject({ "src/app.js": HANDLER }, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", ".", "--fix-preview", "--format", "json"], dir);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const report = JSON.parse(stdout);
      expect(report.summary.fixes).toEqual({ available: 1, notAvailable: 0 });
      const { fix } = report.findings[0];
      expect(fix.status).toBe("available");
      expect(fix.logger).toMatchObject({ kind: "console", call: "console.error", confidence: "low" });
      const inserted = '    console.error("Request failed:", { method: req.method, route: req.route?.path }, err);\n';
      const at = HANDLER.indexOf("    res.status(500)");
      expect(fix.edits).toEqual([{ start: at, end: at, newText: inserted }]);
      expect(fix.diff).toContain("+++ b/src/app.js");
    });
  });

  it("reads an imported logger module only when it is inside the scanned folder", () => {
    const routes = HANDLER.replace('const app = express();', 'const logger = require("../lib/logger");\nconst app = express();');
    const files = { "src/routes/users.js": routes, "src/lib/logger.js": 'module.exports = require("pino")();\n' };
    withProject(files, (dir) => {
      const loggerOf = (target: string) => JSON.parse(runCli(["scan", target, "--fix-preview", "--format", "json"], dir).stdout).findings[0].fix.logger;

      expect(loggerOf("src")).toMatchObject({ kind: "pino", call: "logger.error" }); //   ../lib/logger.js is inside src/
      expect(loggerOf("src/routes")).toMatchObject({ kind: "console" }); //                ... but outside src/routes/
      expect(loggerOf("src/routes").evidence).toContain('this file imports `logger` from "../lib/logger"');
    });
  });

  it("writes fix: null and summary.fixes: null in JSON without --fix-preview", () => {
    withProject({ "src/app.js": HANDLER }, (dir) => {
      const report = JSON.parse(runCli(["scan", ".", "--format", "json"], dir).stdout);
      expect(report.config.fixPreview).toBe(false);
      expect(report.summary.fixes).toBeNull();
      expect(report.findings[0].fix).toBeNull();
    });
  });
});

// v0.4.2: three early testers saw paths relative to the folder LogPilot was run from, which broke
// on another drive (D:/... in the report, "a/D:/..." in diff headers) and with "../..".
// CHANGED ON PURPOSE (v0.4.3): LP001 is off by default; these tests use empty catches (LP001) as
// findings to check other behaviour, so their scans pass --enable LP001.
describe("CLI: every path is relative to the scanned folder (v0.4.2)", () => {
  const ROUTE = [
    'const express = require("express");',
    "const app = express();",
    'app.get("/users", async (req, res) => {',
    "  try {",
    "    res.json(await loadUsers());",
    "  } catch (err) {",
    '    res.status(500).json({ message: "Server error" });',
    "  }",
    "});",
    "",
  ].join("\n");
  // Spaces in the scanned folder's own name and inside the project.
  const files = { "my project/src/my routes/users.js": ROUTE, "my project/src/app.js": EMPTY_CATCH, "elsewhere/deeper/.keep": "" };

  /** The text report (stdout) of `scan <target> --fix-preview`, run from `cwd`. */
  function textReport(target: string, cwd: string): string {
    const { exitCode, stdout, stderr } = runCli(["scan", "--enable", "LP001", target, "--fix-preview", "--no-config"], cwd);
    expect([exitCode, stderr]).toEqual([0, ""]);
    return stdout;
  }

  it("prints the same report from the project, from another folder or drive, and with ../..", () => {
    withProject(files, (dir) => {
      const project = path.join(dir, "my project");
      const fromInside = textReport(".", project);
      const absoluteFromRepo = textReport(project, projectRoot); // on Windows CI and here: another drive than the temp folder
      const relativeUp = textReport("../../my project", path.join(dir, "elsewhere", "deeper"));

      expect(fromInside).toMatch(/^src\/app\.js:1:17$/m);
      expect(fromInside).toMatch(/^src\/my routes\/users\.js:6:5$/m);
      expect(fromInside).toContain("    --- a/src/my routes/users.js\n    +++ b/src/my routes/users.js\n");
      expect(absoluteFromRepo).toBe(fromInside);
      expect(relativeUp).toBe(fromInside);
      for (const report of [fromInside, absoluteFromRepo, relativeUp]) {
        expect(report).not.toContain("../");
        expect(report).not.toMatch(/[A-Za-z]:[\/]/); // no drive letter (C:/, D:\)
        expect(report).not.toContain(path.basename(dir)); // no part of the temp folder's path
      }
    });
  });

  it.runIf(process.platform === "win32")("works when the scanned folder is on another drive than the current folder (Windows)", () => {
    withProject(files, (dir) => {
      const drive = (p: string) => path.parse(path.resolve(p)).root.toUpperCase();
      // Precondition: the temp folder and this repository are on different drives (true on this
      // machine and on GitHub's Windows runners), or this test proves nothing.
      expect(drive(dir), "the temp folder is on the same drive as the repository").not.toBe(drive(projectRoot));

      const report = textReport(path.join(dir, "my project"), projectRoot);
      expect(report).toContain("    --- a/src/my routes/users.js\n");
      expect(report).not.toContain(`a/${drive(dir)}`); //                       a/C:\
      expect(report).not.toContain(`a/${drive(dir).split(path.sep).join("/")}`); // a/C:/
    });
  });

  it("shows a single scanned file relative to its own folder", () => {
    withProject(files, (dir) => {
      const report = textReport(path.join(dir, "my project", "src", "my routes", "users.js"), projectRoot);

      expect(report).toMatch(/^users\.js:6:5$/m);
      expect(report).toContain("    --- a/users.js\n    +++ b/users.js\n");
    });
  });

  it("writes the same relative paths in JSON, and its diffs apply with git apply in the scanned folder", () => {
    withProject(files, (dir) => {
      const project = path.join(dir, "my project");
      const { stdout } = runCli(["scan", "--enable", "LP001", project, "--fix-preview", "--format", "json", "--no-config"], projectRoot);
      const report = JSON.parse(stdout);

      expect(report.findings.map((f: { file: string }) => f.file)).toEqual(["src/app.js", "src/my routes/users.js"]);
      const diff: string = report.findings[1].fix.diff;
      expect(diff.startsWith("--- a/src/my routes/users.js\n+++ b/src/my routes/users.js\n@@ ")).toBe(true);

      // The real check that the headers are valid: git itself accepts the diff (it only checks; nothing is changed).
      writeFileSync(path.join(dir, "fix.diff"), diff);
      const check = spawnSync("git", ["apply", "--check", "--verbose", path.join(dir, "fix.diff")], { cwd: project, encoding: "utf8" });
      expect(check.error, "git must be installed to run this test").toBeUndefined();
      expect([check.status, check.stderr]).toEqual([0, "Checking patch src/my routes/users.js...\n"]);
    });
  });

  it("shows the config file and the exclude root relative to the scanned folder too", () => {
    withProject({ ...files, "logpilot.config.json": '{ "exclude": ["nothing/**"] }', ".git/HEAD": "ref: refs/heads/main\n" }, (dir) => {
      const { stdout, stderr } = runCli(["scan", "--enable", "LP001", path.join(dir, "my project")], projectRoot);

      expect(stdout).toContain("Config file: ../logpilot.config.json\n");
      expect(stderr).toBe('Warning: exclude pattern "nothing/**" matched nothing (patterns are relative to ..); check the spelling\n');
    });
  });
});

// v0.4.2: an early tester's Next.js project got 0 LP003 findings without knowing LP003 had nothing to check.
// CHANGED ON PURPOSE (v0.4.3): LP001 is off by default; these tests use empty catches (LP001) as
// findings to check other behaviour, so their scans pass --enable LP001.
describe("CLI: says when no Express handler was found (v0.4.2)", () => {
  const line = "No Express handlers found: LP003 and fix previews only check Express apps.\n";

  it("says so once, in the summary, when no scanned file has an Express handler", () => {
    withProject({ "a.js": EMPTY_CATCH, "b.ts": "export async function GET() { return Response.json({ ok: true }); }\n" }, (dir) => {
      const { stdout } = runCli(["scan", "--enable", "LP001", "."], dir);

      expect(stdout.endsWith(`Scanned 2 files, 1 finding (LP001: 1)\n${line}`)).toBe(true);
      expect(stdout.split(line)).toHaveLength(2); // exactly once
      expect(JSON.parse(runCli(["scan", "--enable", "LP001", ".", "--format", "json"], dir).stdout).summary.filesWithExpressHandlers).toBe(0);
    });
  });

  it("does not say it when at least one file has an Express handler, even one with no finding", () => {
    const handled = 'const app = require("express")();\napp.get("/", (req, res) => { res.json({ ok: true }); });\n';
    withProject({ "a.js": EMPTY_CATCH, "server.js": handled }, (dir) => {
      const { stdout } = runCli(["scan", "--enable", "LP001", "."], dir);

      expect(stdout).not.toContain("No Express handlers");
      expect(JSON.parse(runCli(["scan", "--enable", "LP001", ".", "--format", "json"], dir).stdout).summary.filesWithExpressHandlers).toBe(1);
    });
  });

  it("does not say it when nothing was scanned", () => {
    withProject({ "notes.md": "# notes\n" }, (dir) => {
      expect(runCli(["scan", "."], dir).stdout).toBe("Scanned 0 files, 0 findings\n");
    });
  });
});

// v0.4.3: LP001 is off by default; "rules" in the config file and --enable turn rules on or off.
describe("CLI: rules on and off (v0.4.3)", () => {
  const files = { "a.js": EMPTY_CATCH, "b.js": 'try { load(); } catch (err) { throw new Error("load failed"); }\n' };
  const offLine =
    'LP001 (empty-catch) is off by default: most empty catches are deliberate. Turn it on with "rules": { "LP001": "on" } ' +
    "in logpilot.config.json, or --enable LP001.\n";

  it("does not run LP001 by default, and says so once in the summary", () => {
    withProject(files, (dir) => {
      const { exitCode, stdout } = runCli(["scan", "."], dir);

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain("LP001 empty-catch |");
      expect(stdout.endsWith(`Scanned 2 files, 1 finding (LP002: 1)\nNo Express handlers found: LP003 and fix previews only check Express apps.\n${offLine}`)).toBe(true);
    });
  });

  it("--fail-on no longer fails on an empty catch by default (it did before v0.4.3), only with LP001 on", () => {
    withProject({ "a.js": EMPTY_CATCH }, (dir) => {
      expect(runCli(["scan", ".", "--fail-on", "low"], dir).exitCode).toBe(0);
      expect(runCli(["scan", ".", "--fail-on", "low", "--enable", "LP001"], dir).exitCode).toBe(1);
    });
  });

  it("turns LP001 on with --enable or with the config file, and then does not print the line", () => {
    withProject(files, (dir) => {
      const flag = runCli(["scan", ".", "--enable", "LP001"], dir).stdout;
      expect(flag).toContain("Scanned 2 files, 2 findings (LP001: 1, LP002: 1)\n");
      expect(flag).not.toContain("off by default");
    });
    withProject({ ...files, "logpilot.config.json": '{ "rules": { "LP001": "on" } }' }, (dir) => {
      const config = runCli(["scan", "."], dir).stdout;
      expect(config).toContain("Scanned 2 files, 2 findings (LP001: 1, LP002: 1)\n");
      expect(config).not.toContain("off by default");
    });
  });

  it("does not print the line when the config file turns LP001 off on purpose; --enable wins over the config file", () => {
    withProject({ ...files, "logpilot.config.json": '{ "rules": { "LP001": "off", "LP002": "off" } }' }, (dir) => {
      const off = runCli(["scan", "."], dir).stdout;
      expect(off).toContain("Scanned 2 files, 0 findings\n");
      expect(off).not.toContain("off by default");

      expect(runCli(["scan", ".", "--enable", "LP001"], dir).stdout).toContain("Scanned 2 files, 1 finding (LP001: 1)\n");
      expect(runCli(["scan", ".", "--enable", "LP001", "--enable", "LP002"], dir).stdout).toContain(
        "Scanned 2 files, 2 findings (LP001: 1, LP002: 1)\n",
      );
    });
  });

  it("rejects an unknown rule in --enable (exit code 2), and in the config file", () => {
    withProject(files, (dir) => {
      const unknown = runCli(["scan", ".", "--enable", "LP009"], dir);
      expect([unknown.exitCode, unknown.stdout]).toEqual([2, ""]);
      expect(unknown.stderr).toContain('Error: --enable "LP009": unknown rule (known rules: LP001, LP002, LP003)');
    });
    withProject({ ...files, "logpilot.config.json": '{ "rules": { "LP001": "yes" } }' }, (dir) => {
      const bad = runCli(["scan", "."], dir);
      expect([bad.exitCode, bad.stderr]).toEqual([2, 'Error: logpilot.config.json: "rules": "LP001" must be "on" or "off"\n']);
    });
  });

  it("writes rules[].enabled and config.rules in JSON (schema version stays 3)", () => {
    withProject(files, (dir) => {
      const report = JSON.parse(runCli(["scan", ".", "--format", "json"], dir).stdout);

      expect(report.schemaVersion).toBe(3);
      expect(report.rules.map((r: { id: string; enabled: boolean }) => [r.id, r.enabled])).toEqual([
        ["LP001", false],
        ["LP002", true],
        ["LP003", true],
      ]);
      expect(report.config.rules).toEqual({ LP001: "off", LP002: "on", LP003: "on" });
      expect(report.summary.findingsByRule).toEqual({ LP001: 0, LP002: 1, LP003: 0 });
    });
  });

  it("documents --enable and the rules in --help", () => {
    const { stdout } = runCli(["--help"]);
    expect(stdout).toContain("--enable <rule>");
    expect(stdout).toContain("LP001 empty-catch (off by default)");
  });
});

// v0.4.3: findings with the same pattern are listed under the first one (LP001 and LP002).
describe("CLI: repeated patterns (v0.4.3)", () => {
  const thrower = (cls: string, msg: string) => `try { load(); } catch (err) { throw new ${cls}("${msg}"); }\n`;
  const files = {
    "a.js": thrower("ApiError", "a"),
    "b.js": thrower("ApiError", "b"),
    "c.js": thrower("ApiError", "c"),
    "d.js": thrower("NotFoundError", "d"),
  };

  it("lists every location of a pattern under its first finding, and counts patterns in the summary", () => {
    withProject(files, (dir) => {
      const { stdout } = runCli(["scan", "."], dir);

      expect(stdout).toContain("  Same pattern in 2 more places (throw new ApiError(...) without the caught error):\n    b.js:1:31\n    c.js:1:31\n");
      expect(stdout).not.toMatch(/^b\.js:1:31$/m); // not printed again on its own
      expect(stdout).toMatch(/^d\.js:1:31$/m); //     another class: its own pattern
      expect(stdout).toContain("Scanned 4 files, 4 findings in 2 patterns (LP002: 4)\n");
    });
  });

  it("--verbose shows every finding in full", () => {
    withProject(files, (dir) => {
      const { stdout } = runCli(["scan", ".", "--verbose"], dir);

      expect(stdout).not.toContain("Same pattern");
      expect(stdout).toMatch(/^b\.js:1:31$/m);
      expect(stdout).toContain("Scanned 4 files, 4 findings in 2 patterns (LP002: 4)\n");
    });
  });

  it("gives each finding a stable pattern ID in JSON, and counts patterns", () => {
    withProject(files, (dir) => {
      const report = JSON.parse(runCli(["scan", ".", "--format", "json"], dir).stdout);
      const ids = report.findings.map((f: { pattern: string }) => f.pattern);

      expect(ids[0]).toMatch(/^LP002-[0-9a-f]{8}$/);
      expect(ids.slice(0, 3)).toEqual([ids[0], ids[0], ids[0]]);
      expect(ids[3]).not.toBe(ids[0]);
      expect(report.summary.patterns).toBe(2);
      expect(runCli(["scan", ".", "--format", "json"], dir).stdout).toBe(JSON.stringify(report, null, 2) + "\n"); // same every run
    });
  });

  it("never groups LP003 findings, even identical ones", () => {
    const handler = (route: string) =>
      `const app = require("express")();\napp.get("${route}", async (req, res) => {\n  try { res.json(await load()); } catch (err) { res.status(500).json({ message: "Server error" }); }\n});\n`;
    withProject({ "a.js": handler("/a"), "b.js": handler("/b") }, (dir) => {
      const { stdout } = runCli(["scan", "."], dir);
      const report = JSON.parse(runCli(["scan", ".", "--format", "json"], dir).stdout);

      expect(stdout).not.toContain("Same pattern");
      expect(stdout).toContain("Scanned 2 files, 2 findings (LP003: 2)\n");
      expect(report.findings.map((f: { pattern: string | null }) => f.pattern)).toEqual([null, null]);
      expect(report.summary.patterns).toBe(2);
    });
  });
});
