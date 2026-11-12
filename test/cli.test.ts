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

describe("CLI: scan", () => {
  it("exits 0 with '0 findings' when the code handles its errors (all rules run)", () => {
    const { exitCode, stdout, stderr } = runCli(["scan", "test/fixtures/negative"]);

    expect(exitCode).toBe(0);
    // 7 files written for LP001 + 3 for LP002 + 1 for LP003 (added in Milestone 2.5); no rule may
    // report any of them.
    expect(stdout).toBe("Scanned 11 files, 0 findings\n");
    expect(stderr).toBe("");
  });

  it("prints every finding when there are problems, and exits 0 by default (warning-only)", () => {
    const { exitCode, stdout, stderr } = runCli(["scan", "test/fixtures/positive"]);

    // EXIT CODE CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none", so findings alone
    // exit 0. Exit code 1 with --fail-on is tested in "CLI: severity filtering and --fail-on".
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("test/fixtures/positive/empty-catch.ts:9:5\n");
    expect(stdout).toContain("  LP001 empty-catch | severity: medium | confidence: high\n"); // the default
    expect(stdout).toContain("  LP001 empty-catch | severity: high | confidence: high\n"); // with positive evidence
    expect(stdout).toContain("test/fixtures/positive/comment-only-catch.js:7:5\n");
    // CHANGED ON PURPOSE (Milestone 2.5): a comment lowers only confidence (severity was "low").
    expect(stdout).toContain("  LP001 empty-catch | severity: medium | confidence: medium\n"); // comment-only (rule 1)
    expect(stdout).toContain("    9 |   } catch (err) {}\n"); // gutter is as wide as the largest line number shown
    expect(stdout).toContain("test/fixtures/positive/lp002-message-only.js:10:5\n");
    expect(stdout).toContain("  LP002 lost-error-cause | severity: medium | confidence: high\n");
    expect(stdout).toContain("  Why: ");
    expect(stdout).toContain("  Fix: ");
    // LP001: 6 (original) + 4 (test-assertion) + 4 (unexplained-comments) + 3 (inside-error-handling-lost)
    //        + 6 (guarded-swallow) + 10 (tool-directives) + 6 (test-assertion-more) = 39
    // LP002: 4 (lost-cause) + 5 (message-only) + 2 (options-mistake) + 3 (no-binding) = 14
    // LP003: 8 (error-responses) + 3 (error-middleware) + 3 (response-helpers) = 14
    // (Milestone 2.5 added the tool-directives, test-assertion-more and 3 LP003 fixtures: 11 -> 16 files.)
    expect(stdout.endsWith("Scanned 16 files, 67 findings (LP001: 39, LP002: 14, LP003: 14)\n")).toBe(true);
  });

  it("scans the whole fixtures folder (edge + negative + positive)", () => {
    const { exitCode, stdout } = runCli(["scan", "test/fixtures"]);

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
    expect(stdout.endsWith("Scanned 52 files, 120 findings (LP001: 54, LP002: 23, LP003: 43)\n")).toBe(true);
  });

  it("scans a single file", () => {
    const { exitCode, stdout } = runCli(["scan", "test/fixtures/positive/empty-catch.ts"]);

    // EXIT CODE CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none" (was 1 with findings).
    expect(exitCode).toBe(0);
    expect(stdout.endsWith("Scanned 1 file, 3 findings (LP001: 3)\n")).toBe(true);
  });

  it("scans the current folder when no path is given", () => {
    const { exitCode, stdout } = runCli(["scan"], path.join(fixturesDir, "negative"));

    expect(exitCode).toBe(0);
    expect(stdout).toBe("Scanned 11 files, 0 findings\n"); // 10 + LP003's negative fixture (Milestone 2.5)
  });

  it("exits 2 with a clear error when the path does not exist", () => {
    const { exitCode, stdout, stderr } = runCli(["scan", "does-not-exist"]);

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toBe('Error: path "does-not-exist" does not exist\n');
  });

  it("does not create, delete or modify any file it scans", () => {
    const before = fingerprintFolder(fixturesDir);
    // CHANGED ON PURPOSE (Milestone 2): findings alone now exit 0, so "--fail-on low" is passed to
    // keep using exit code 1 as proof that the scan really ran and found the positives.
    const { exitCode } = runCli(["scan", "test/fixtures", "--fail-on", "low"]);
    const after = fingerprintFolder(fixturesDir);

    expect(exitCode).toBe(1); // the scan really ran and found the positives
    // CHANGED ON PURPOSE (Milestone 3): 4 fix-preview fixtures added in test/fixtures/fix/.
    // CHANGED ON PURPOSE (Milestone 3, Checkpoint 3): 10 more in test/fixtures/fix/loggers/.
    expect(Object.keys(before)).toHaveLength(52); // 29 + 3 LP001 and 6 LP003 (Milestone 2.5) + 14 fix (Milestone 3)
    expect(after).toEqual(before);
  });

  it("does not create, delete or modify any file with --fix-preview either (fixes are only shown)", () => {
    const before = fingerprintFolder(fixturesDir);
    const { exitCode, stdout } = runCli(["scan", "test/fixtures", "--fix-preview", "--fail-on", "low"]);
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

describe("CLI: what was not scanned (Milestone 2)", () => {
  const files = { "src/app.js": EMPTY_CATCH, "node_modules/lib/index.js": EMPTY_CATCH, "build/out.js": EMPTY_CATCH };

  it("says in the summary how much was not scanned, and why", () => {
    withProject(files, (dir) => {
      const { stdout } = runCli(["scan", "."], dir);

      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
      expect(stdout).toContain(
        "Not scanned: 2 folders (default folders: 2). Run with --show-skipped to list them.\n",
      );
    });
  });

  it("--show-skipped lists every skipped folder with its reason", () => {
    withProject(files, (dir) => {
      const { stdout, stderr } = runCli(["scan", ".", "--show-skipped"], dir);

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
      const { exitCode, stdout, stderr } = runCli(["scan", "."], dir);

      expect(exitCode).toBe(0); // no findings: a syntax error alone does not fail the scan
      expect(stderr).toBe(
        "Warning: broken.js: 1 syntax error (first at line 1: Expression expected.); " +
          "findings in this file may be incomplete\n",
      );
      expect(stdout).toBe(
        "Scanned 1 file, 0 findings\n1 file had syntax errors; findings in it may be incomplete (see the warnings).\n",
      );
    });
  });

  it("uses logpilot.config.json from the scanned folder, and says so in the summary", () => {
    withProject({ ...files, "logpilot.config.json": '{ "defaultExcludes": false }' }, (dir) => {
      const { stdout } = runCli(["scan", "."], dir);

      expect(stdout).toContain("Scanned 2 files, 2 findings (LP001: 2)\n"); // build/ is scanned now
      expect(stdout).toContain("Config file: logpilot.config.json\n");
    });
  });

  it("stops with exit code 2 and a clear message when the config file is invalid", () => {
    withProject({ ...files, "logpilot.config.json": '{ "excludes": ["docs/**"] }' }, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", "."], dir);

      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toBe(
        'Error: logpilot.config.json: unknown setting "excludes" (known settings: exclude, defaultExcludes, minSeverity, failOn)\n',
      );
    });
  });

  it("--config uses the given file; --no-config ignores config files; both together is an error", () => {
    withProject({ ...files, "logpilot.config.json": "{ broken", "settings/strict.json": '{ "defaultExcludes": false }' }, (dir) => {
      // EXIT CODES CHANGED ON PURPOSE (Milestone 2): --fail-on defaults to "none", so these scans with
      // findings exit 0 (was 1). What matters here is that they are not 2, the code for a broken config.
      const withConfig = runCli(["scan", ".", "--config", "settings/strict.json"], dir);
      expect(withConfig.exitCode).toBe(0);
      expect(withConfig.stdout).toContain("Config file: settings/strict.json\n");

      const noConfig = runCli(["scan", ".", "--no-config"], dir);
      expect(noConfig.exitCode).toBe(0); // the broken logpilot.config.json was not read
      expect(noConfig.stdout).not.toContain("Config file:");

      const missing = runCli(["scan", ".", "--config", "nope.json"], dir);
      expect(missing.exitCode).toBe(2);
      expect(missing.stderr).toBe('Error: config file "nope.json" does not exist\n');

      const both = runCli(["scan", ".", "--config", "settings/strict.json", "--no-config"], dir);
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
      const { stdout, stderr } = runCli(["scan", "packages/web", "--exclude", "packages/web/scripts/**"], dir);

      expect(stderr).toBe("");
      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
      expect(stdout).toContain("Not scanned: 2 folders (your exclude patterns: 2).");
      expect(stdout).toContain("Config file: logpilot.config.json\n");
    });
  });

  it("warns about an exclude pattern that matched nothing, and rejects an invalid one with exit code 2", () => {
    withProject(files, (dir) => {
      const unused = runCli(["scan", ".", "--exclude", "doc/**"], dir);
      expect(unused.stderr).toBe('Warning: exclude pattern "doc/**" matched nothing (patterns are relative to .); check the spelling\n');

      const invalid = runCli(["scan", ".", "--exclude", "!src/app.js"], dir);
      expect(invalid.exitCode).toBe(2);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toContain('Error: --exclude "!src/app.js": patterns that start with "!" (exceptions) are not supported');
    });
  });

  it("ignores a stray config file above the repository root", () => {
    withProject({ "logpilot.config.json": "{ broken", "repo/.git/HEAD": "ref: refs/heads/main\n", "repo/src/app.js": EMPTY_CATCH }, (dir) => {
      const { exitCode, stdout } = runCli(["scan", "."], path.join(dir, "repo"));

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
      const { stdout, stderr } = runCli(["scan", "."], dir);

      expect(stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n1 finding was suppressed by logpilot-ignore comments.\n");
      expect(stdout).toContain("src/cache.js:6:1\n"); // the one without a reason is still reported
      expect(stderr).toBe(
        'Warning: src/cache.js:5: this suppression has no reason; add "-- why" after the rule ID (it was not applied)\n',
      );
    });
  });

  it("--no-default-excludes scans build output and minified files, but never node_modules", () => {
    withProject({ ...files, "public/app.min.js": EMPTY_CATCH }, (dir) => {
      const { stdout } = runCli(["scan", ".", "--no-default-excludes"], dir);

      expect(stdout).toContain("Scanned 3 files, 3 findings (LP001: 3)\n");
      expect(stdout).toContain("Not scanned: 1 folder (default folders: 1).");
    });
  });
});

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
      const { exitCode, stdout } = runCli(["scan", "levels.js"], dir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Scanned 1 file, 3 findings (LP001: 3)\n");
    });
  });

  it("--min-severity hides lower findings and says how many", () => {
    withProject(project, (dir) => {
      const medium = runCli(["scan", "levels.js", "--min-severity", "medium"], dir);
      expect(medium.stdout).toContain("Scanned 1 file, 2 findings (LP001: 2)\n");
      expect(medium.stdout).toContain("1 finding below medium severity is not shown (--min-severity).\n");
      expect(medium.stdout).not.toContain("levels.js:3:");

      const high = runCli(["scan", "levels.js", "--min-severity", "high"], dir);
      expect(high.stdout).toContain("Scanned 1 file, 1 finding (LP001: 1)\n");
      expect(high.stdout).toContain("2 findings below high severity are not shown (--min-severity).\n");
    });
  });

  it("--fail-on exits 1 only when a finding is at or above the level", () => {
    withProject(project, (dir) => {
      expect(runCli(["scan", "levels.js", "--fail-on", "high"], dir).exitCode).toBe(1);
      expect(runCli(["scan", "medium-only.js", "--fail-on", "high"], dir).exitCode).toBe(0);
      expect(runCli(["scan", "medium-only.js", "--fail-on", "medium"], dir).exitCode).toBe(1);
      expect(runCli(["scan", "medium-only.js", "--fail-on", "none"], dir).exitCode).toBe(0);
    });
  });

  it("refuses to fail on findings it does not show, and rejects unknown levels (exit code 2)", () => {
    withProject(project, (dir) => {
      const hidden = runCli(["scan", ".", "--min-severity", "high", "--fail-on", "medium"], dir);
      expect(hidden.exitCode).toBe(2);
      expect(hidden.stdout).toBe("");
      expect(hidden.stderr).toContain('Error: fail-on "medium" is below min-severity "high"');

      const unknown = runCli(["scan", ".", "--fail-on", "always"], dir);
      expect(unknown.exitCode).toBe(2);
      expect(unknown.stderr).toContain('--fail-on must be one of none, low, medium, high (got "always")');
    });
  });

  it("reads minSeverity and failOn from the config file; command-line options win", () => {
    withProject({ ...project, "logpilot.config.json": '{ "minSeverity": "medium", "failOn": "high" }' }, (dir) => {
      const fromConfig = runCli(["scan", "levels.js"], dir);
      expect(fromConfig.exitCode).toBe(1); // a high finding, failOn "high"
      expect(fromConfig.stdout).toContain("1 finding below medium severity is not shown");

      const overridden = runCli(["scan", "levels.js", "--fail-on", "none", "--min-severity", "low"], dir);
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

describe("CLI: JSON output and --output (Milestone 2)", () => {
  const project = {
    "src/app.js": EMPTY_CATCH,
    "src/broken.js": "let x = ;\n",
    "src/kept.js": ["// logpilot-ignore-next-line LP001 -- the cache is optional", "try { a(); } catch {}", ""].join("\n"),
    "dist/out.js": EMPTY_CATCH,
  };

  it("prints only JSON on stdout: warnings go into the JSON, not to stderr", () => {
    withProject(project, (dir) => {
      const { exitCode, stdout, stderr } = runCli(["scan", ".", "--format", "json"], dir);

      expect(exitCode).toBe(0);
      expect(stderr).toBe(""); // the syntax-error warning is in the JSON instead
      const report = JSON.parse(stdout);
      // CHANGED ON PURPOSE (Milestone 3): schema version 2 adds fix, config.fixPreview and summary.fixes.
      expect(report.schemaVersion).toBe(2);
      // CHANGED ON PURPOSE (Milestone 2.5): LP001 changed behaviour, so its version went from 1 to 2.
      // CHANGED ON PURPOSE (Milestone 2.5): LP003 was added.
      // CHANGED ON PURPOSE (Milestone 2.5): LP003 case E severity went from medium to low: version 1 -> 2.
      // CHANGED ON PURPOSE (Milestone 3): LP003's suggestion logs req.method and req.route?.path instead
      // of req.path: version 2 -> 3.
      expect(report.rules).toEqual([
        { id: "LP001", name: "empty-catch", version: 2 },
        { id: "LP002", name: "lost-error-cause", version: 1 },
        { id: "LP003", name: "unlogged-error-response", version: 3 },
      ]);
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
      const first = runCli(["scan", ".", "--format", "json"], dir).stdout;
      const second = runCli(["scan", ".", "--format", "json"], dir).stdout;

      expect(first.length).toBeGreaterThan(0);
      expect(second).toBe(first);
    });
  });

  it("applies --min-severity and --fail-on, and records the exit code in the summary", () => {
    withProject(project, (dir) => {
      const { exitCode, stdout } = runCli(["scan", ".", "--format", "json", "--fail-on", "medium"], dir);

      expect(exitCode).toBe(1);
      expect(JSON.parse(stdout).summary.exitCode).toBe(1);
      expect(JSON.parse(stdout).config.failOn).toBe("medium");

      const high = JSON.parse(runCli(["scan", ".", "--format", "json", "--min-severity", "high"], dir).stdout);
      expect(high.findings).toEqual([]);
      expect(high.summary.hiddenBelowMinSeverity).toBe(1);
    });
  });

  it("--output writes the report to a file and prints nothing", () => {
    withProject(project, (dir) => {
      const expected = runCli(["scan", ".", "--format", "json"], dir).stdout;
      const { exitCode, stdout, stderr } = runCli(["scan", ".", "--format", "json", "--output", "report.json"], dir);

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(readFileSync(path.join(dir, "report.json"), "utf8")).toBe(expected);

      // Text reports can be written to a file too; warnings still go to the screen (stderr).
      const text = runCli(["scan", ".", "--output", "report.txt"], dir);
      expect(text.stdout).toBe("");
      expect(text.stderr).toContain("Warning: src/broken.js: 1 syntax error");
      expect(readFileSync(path.join(dir, "report.txt"), "utf8")).toContain("Scanned 3 files, 1 finding (LP001: 1)\n");
    });
  });

  it("refuses to write the report into a JavaScript or TypeScript file (exit code 2)", () => {
    withProject(project, (dir) => {
      for (const target of ["src/app.js", "src/new.ts", "src/App.TSX"]) {
        const { exitCode, stdout, stderr } = runCli(["scan", ".", "--output", target], dir);
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
      const xml = runCli(["scan", ".", "--format", "xml"], dir);
      expect(xml.exitCode).toBe(2);
      expect(xml.stderr).toContain('--format must be text or json (got "xml")');

      const noFolder = runCli(["scan", ".", "--output", "missing-folder/report.json"], dir);
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
