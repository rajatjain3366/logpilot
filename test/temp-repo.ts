// Test helper (not a test file): throw-away git repositories in the system temp folder, for the
// tests of git.ts, fix-preconditions.ts and fix-write.ts. Never inside this repository.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findProgram } from "../src/git.js";

/**
 * Runs git in `repo` (test setup only) and returns what it printed. git's messages on stderr are
 * captured, never printed, and included in the error when git fails. Like LogPilot, it runs git by
 * its full path, so a planted git.exe in the current folder cannot run.
 */
export function git(repo: string, ...args: string[]): string {
  const executable = findProgram("git");
  if (executable === undefined) throw new Error("git is not installed, or not on your PATH (the tests need it)");
  const result = spawnSync(executable, ["-C", repo, ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed (exit code ${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

/** Writes files (path relative to `root` -> text or bytes), creating folders as needed. */
export function writeFiles(root: string, files: Record<string, string | Buffer>): void {
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
}

/**
 * Creates a git repository in a new temp folder (named "my repo", with a space on purpose), writes
 * `files`, commits them, runs `body(repo)`, then deletes everything. `autocrlf` is set explicitly,
 * because Git for Windows (and GitHub's Windows runners) default to core.autocrlf=true, and
 * core.safecrlf=false stops git's "LF will be replaced by CRLF" warnings for the files written here.
 */
export function withRepo(
  files: Record<string, string | Buffer>,
  body: (repo: string) => void,
  options: { autocrlf?: "true" | "false" } = {},
): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-fix-test-"));
  const repo = path.join(dir, "my repo");
  try {
    mkdirSync(repo);
    git(repo, "init", "-q");
    git(repo, "config", "core.autocrlf", options.autocrlf ?? "false");
    git(repo, "config", "core.safecrlf", "false");
    git(repo, "config", "user.name", "LogPilot test");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "commit.gpgsign", "false");
    writeFiles(repo, files);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "--allow-empty", "-m", "initial");
    body(repo);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Windows only: the 8.3 short spelling of an existing path (C:\Users\RUNNER~1\...), as GitHub's
 * Windows runners give for the temp folder. Same folder, different spelling.
 */
export function shortPath(longPath: string): string {
  return spawnSync("cmd.exe", [`/d /s /c "for %I in ("${longPath}") do @echo %~sI"`], {
    encoding: "utf8",
    windowsVerbatimArguments: true, // cmd.exe needs its quotes exactly as written
    windowsHide: true,
  }).stdout.trim();
}

/** A temp folder that is NOT a git repository; deleted after `body`. */
export function withFolder(body: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-fix-test-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
