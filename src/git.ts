// Git, for `logpilot fix`: where the repository is, which files git tracks, which have changes,
// and the exact bytes `git checkout` would give back for a file. Every change LogPilot writes must
// be undoable with git, so a file may only be changed when git can restore it byte for byte.
//
// How git is run, and why:
// - with fixed arguments and without a shell (spawnSync with an argument list), so no file name or
//   path can ever be read as a command;
// - `-c core.fsmonitor=false`: that setting can make `git status` start another program;
// - `--no-optional-locks`: `git status` would otherwise refresh .git/index, which is a write;
// - `-C <folder>`: git runs on that repository, whatever the current folder is;
// - by its FULL path, found by LogPilot in the absolute folders of PATH (see findProgram). On
//   Windows, Node (like Windows itself) looks for a program named only "git" in the CURRENT FOLDER
//   first, unless the NoDefaultCurrentDirectoryInExePath variable is set. A project that contains a
//   git.exe at its top would then run that file instead of git. (Milestone 4's spike missed this:
//   the environment it ran in had that variable set. An early user's Git Bash did not.)
// Nothing here writes to the working tree or the repository.

import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";

/** What `git` printed and how it ended. */
interface GitResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
  /** The program that was run (its full path), for error messages. */
  program: string;
}

/** Git could not be run or answered with an error that stops `logpilot fix`. */
export class GitError extends Error {}

/**
 * The full path of the program `name` ("git"), found in the folders listed in PATH, or undefined.
 * Only ABSOLUTE folders are searched: never the current folder, and never a relative PATH entry
 * such as "." (on Linux and macOS, an empty or relative PATH entry would also mean the current folder).
 */
export function findProgram(name: string, searchPath = process.env.PATH ?? ""): string | undefined {
  const fileName = process.platform === "win32" && !name.toLowerCase().endsWith(".exe") ? `${name}.exe` : name;
  for (const entry of searchPath.split(path.delimiter)) {
    const folder = entry.replace(/^"(.*)"$/, "$1"); // Windows allows "C:\Program Files\Git\cmd" with quotes
    if (folder === "" || !path.isAbsolute(folder)) continue;
    const candidate = path.join(folder, fileName);
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return undefined;
}

/**
 * Runs git with fixed arguments in the repository (or folder) `cwd`. `program` exists only so tests
 * can simulate a missing git.
 */
function runGit(cwd: string, args: readonly string[], program = "git"): GitResult {
  const executable = findProgram(program);
  if (executable === undefined) throw new GitError("git is not installed, or not on your PATH");
  const result = spawnSync(executable, ["-c", "core.fsmonitor=false", "--no-optional-locks", "-C", cwd, ...args], {
    shell: false,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) throw new GitError(`git could not be run (${executable}: ${result.error.message})`, { cause: result.error });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.toString("utf8").trim(), program: executable };
}

/** Everything git said about a failure: its whole error output (or normal output), program and exit code. */
function failureDetails(result: GitResult): string {
  const said = result.stderr || result.stdout.toString("utf8").trim() || "it printed nothing";
  return `${said} (${result.program}, exit code ${result.status})`;
}

/** Runs git and returns its output; throws GitError when git reports an error. */
function gitOutput(cwd: string, args: readonly string[], program?: string): Buffer {
  const result = runGit(cwd, args, program);
  if (result.status !== 0) throw new GitError(`git ${args[0]} failed: ${failureDetails(result)}`);
  return result.stdout;
}

/**
 * The root folder of the git repository that contains `folder`, or undefined when `folder` is not
 * in a git repository. Throws GitError when git is missing or refuses the repository (for example
 * git's "dubious ownership" check).
 *
 * The root is returned as its REAL path (realpathSync.native): one spelling for one folder. Windows
 * can name a folder in several ways (C:\Users\RUNNER~1 is the 8.3 short name of C:\Users\runneradmin
 * on GitHub's Windows runners); git always reports long names, so compare it only with real paths.
 */
export function repositoryRoot(folder: string, program?: string): string | undefined {
  const result = runGit(folder, ["rev-parse", "--show-toplevel"], program);
  if (result.status !== 0) {
    if (/not a git repository/i.test(result.stderr)) return undefined;
    throw new GitError(`git does not accept this folder as a repository: ${failureDetails(result)}`);
  }
  return realpathSync.native(path.resolve(result.stdout.toString("utf8").trim()));
}

/** The commit the repository is on (`git rev-parse HEAD`), or undefined before the first commit. */
export function headCommit(root: string, program?: string): string | undefined {
  const result = runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"], program);
  return result.status === 0 ? result.stdout.toString("utf8").trim() : undefined;
}

/** A file in git's index (its staging area). */
export interface IndexEntry {
  /** "100644" (a normal file), "100755" (executable), "120000" (a symbolic link), "160000" (a submodule). */
  mode: string;
  /** The blob (stored content) ID. */
  blob: string;
}

/** Every file in the repository's index: path relative to the root, with "/" -> entry. */
export function indexEntries(root: string, program?: string): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>();
  // Each record: "<mode> <blob> <stage>\t<path>", separated by NUL characters (-z: no quoting).
  for (const record of gitOutput(root, ["ls-files", "--stage", "-z"], program).toString("utf8").split("\0")) {
    const match = /^(\d{6}) ([0-9a-f]+) (\d)\t(.*)$/s.exec(record);
    if (match === null) continue;
    // Stage 1-3 means a merge conflict: such a file is never clean, so mark it as such.
    const mode = match[3] === "0" ? match[1] : "conflict";
    entries.set(match[4], { mode, blob: match[2] });
  }
  return entries;
}

/**
 * Tracked files with changes compared to the last commit, staged or not: path relative to the root,
 * with "/" -> git's two-letter status ("M " staged, " M" not staged, "MM" both, "D ", "R ", ...).
 * Untracked and ignored files are not listed (they are not in the index at all).
 */
export function changedFiles(root: string, program?: string): Map<string, string> {
  const changed = new Map<string, string>();
  const fields = gitOutput(root, ["status", "--porcelain=v1", "-z", "--untracked-files=no"], program).toString("utf8").split("\0");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    changed.set(field.slice(3), xy);
    // A rename or copy is followed by the ORIGINAL path, as a field of its own; that path changed too.
    if (xy.includes("R") || xy.includes("C")) {
      i++;
      if (fields[i]) changed.set(fields[i], xy);
    }
  }
  return changed;
}

/**
 * The exact bytes `git checkout -- <file>` would write for the indexed `blob` of `relativePath`:
 * with git's line-ending conversion (core.autocrlf, .gitattributes) and filters applied.
 */
export function checkoutBytes(root: string, relativePath: string, blob: string, program?: string): Buffer {
  return gitOutput(root, ["cat-file", "--filters", `--path=${relativePath}`, blob], program);
}
