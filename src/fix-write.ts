// Writing a fixed file, for `logpilot fix`. This is the ONLY module of LogPilot that writes source
// files (test/no-write.test.ts checks that no other module imports a file-writing function, except
// cli.ts for the --output report). It writes only after the user answered "y" (see fix-command.ts).
//
// How one file is replaced:
//   1. The file must still have exactly the bytes LogPilot read and checked; otherwise nothing is written.
//   2. The new bytes go to a temporary file in the same folder (".app.js.logpilot-1a2b3c4d.tmp",
//      created with the "wx" flag, so it can never overwrite an existing file), which is flushed to
//      disk (fsync) and given the original file's permissions.
//   3. The temporary file is renamed over the original. The operating system replaces the file in
//      one step, so a crash leaves either the old or the new file, never half of one. On Windows a
//      rename fails while ANY program has the file open (measured in Milestone 4's spike, also with
//      FILE_SHARE_DELETE), and reading fails while a program has it open without sharing, so every
//      step is retried every 100 ms for up to 2 s while a lock blocks it.
//   4. The file is read back. It must have exactly the new bytes and pass the caller's check (the
//      rules re-run on it). If not, the original bytes are written back the same way and checked.
// All of this is synchronous: Ctrl+C is honoured only between files, never in the middle of a write.

import { randomBytes } from "node:crypto";
import { closeSync, chmodSync, fsyncSync, lstatSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** What happened to one file. */
export type WriteOutcome =
  /** The new bytes are on disk and passed the check. */
  | { status: "written" }
  /** Nothing was written: the file is exactly as before. */
  | { status: "not-written"; reason: string }
  /** The new bytes were written but failed the check; the original bytes were written back and verified. */
  | { status: "restored"; reason: string }
  /** The new bytes failed the check AND writing back the original failed: the file may be wrong. */
  | { status: "restore-failed"; reason: string };

export interface ReplaceOptions {
  /** Checks the bytes read back after the write: returns why they are wrong, or undefined. */
  check?: (written: Buffer) => string | undefined;
  /** How long to keep retrying a rename that a lock blocks (default 2000 ms), and how often (default 100 ms). */
  retryForMs?: number;
  retryEveryMs?: number;
  /** Tests only: replace the rename, or run code right after it (to simulate other programs). */
  hooks?: { rename?: (from: string, to: string) => void; afterRename?: (file: string) => void };
}

/** Rename errors that mean "another program has the file open": worth retrying. */
const LOCK_ERRORS = new Set(["EPERM", "EACCES", "EBUSY"]);

/** The name pattern of LogPilot's temporary files (see leftoverTempFiles). */
const TEMP_FILE = /^\..+\.logpilot-[0-9a-f]{8}\.tmp$/;

/**
 * Replaces the contents of `file`, which must still be exactly `original`, with `replacement`.
 * Never throws for problems with the file: every outcome is returned (see WriteOutcome).
 */
export function replaceFile(file: string, original: Buffer, replacement: Buffer, options: ReplaceOptions = {}): WriteOutcome {
  let current: Buffer;
  let mode: number;
  try {
    current = retryWhileLocked(() => readFileSync(file), options);
    mode = lstatSync(file).mode;
  } catch (error) {
    return { status: "not-written", reason: problemWith(error, "it could not be read again") };
  }
  if (!current.equals(original)) {
    return { status: "not-written", reason: "it changed since LogPilot read it (run logpilot fix again to see fixes for the new version)" };
  }

  const writeProblem = atomicWrite(file, replacement, mode, options);
  if (writeProblem !== undefined) return { status: "not-written", reason: writeProblem };
  options.hooks?.afterRename?.(file);

  const problem = checkOnDisk(file, replacement, options.check, options);
  if (problem === undefined) return { status: "written" };

  // The written file is wrong: put the original bytes back, and check that they really are back.
  const restoreProblem = atomicWrite(file, original, mode, options) ?? checkOnDisk(file, original, undefined, options);
  if (restoreProblem === undefined) return { status: "restored", reason: problem };
  return { status: "restore-failed", reason: `${problem}; writing back the original also failed: ${restoreProblem}` };
}

/** Why the bytes on disk are not `expected` or fail `check`, or undefined when all is well. */
function checkOnDisk(file: string, expected: Buffer, check: ReplaceOptions["check"], options: ReplaceOptions): string | undefined {
  let onDisk: Buffer;
  try {
    onDisk = retryWhileLocked(() => readFileSync(file), options); // e.g. a virus scanner reading the new file
  } catch (error) {
    return problemWith(error, "it could not be read back");
  }
  if (!onDisk.equals(expected)) return "the file on disk does not have the bytes LogPilot wrote (did another program change it?)";
  return check?.(onDisk);
}

/**
 * Runs `operation`; while it fails because another program has the file open (on Windows, any open
 * handle blocks a rename, and a handle without sharing blocks reading), tries again every 100 ms
 * for up to 2 s (see ReplaceOptions). Other errors, and a lock that lasts longer, are thrown.
 */
function retryWhileLocked<T>(operation: () => T, options: ReplaceOptions): T {
  const deadline = Date.now() + (options.retryForMs ?? 2000);
  for (;;) {
    try {
      return operation();
    } catch (error) {
      if (!LOCK_ERRORS.has((error as NodeJS.ErrnoException).code ?? "") || Date.now() >= deadline) throw error;
      sleep(options.retryEveryMs ?? 100);
    }
  }
}

/** A failed operation as the reason shown to the user: a lock is named as such, other errors by their code. */
function problemWith(error: unknown, what: string): string {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  if (LOCK_ERRORS.has(code)) return LOCKED;
  return `${what} (${code || (error as Error).message})`;
}

const LOCKED = "it is locked by another program (close the program that has it open, then run logpilot fix again)";

/**
 * Writes `bytes` to a new temporary file next to `file` and renames it over `file`. Returns why it
 * failed (and then `file` is untouched and the temporary file is removed), or undefined.
 */
function atomicWrite(file: string, bytes: Buffer, mode: number, options: ReplaceOptions): string | undefined {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.logpilot-${randomBytes(4).toString("hex")}.tmp`);
  try {
    const fd = openSync(temp, "wx", mode & 0o777);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd); // on disk before the rename, so a crash cannot leave an empty file
    } finally {
      closeSync(fd);
    }
    chmodSync(temp, mode & 0o777); // openSync's mode is reduced by the umask on Linux and macOS
  } catch (error) {
    rmSync(temp, { force: true });
    return `a temporary file next to it could not be written (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`;
  }

  const rename = options.hooks?.rename ?? renameSync;
  try {
    retryWhileLocked(() => rename(temp, file), options);
    return undefined;
  } catch (error) {
    rmSync(temp, { force: true });
    return problemWith(error, "it could not be replaced");
  }
}

/** Waits `ms` milliseconds without returning to the event loop (writes are synchronous on purpose). */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * LogPilot temporary files left in `folders` (only possible if LogPilot was killed in the middle of
 * a write, for example by a power cut). They are only listed, never deleted: the user decides.
 */
export function leftoverTempFiles(folders: Iterable<string>): string[] {
  const found: string[] = [];
  for (const folder of new Set(folders)) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue; // a folder that cannot be listed has no leftovers we could report
    }
    for (const name of names) if (TEMP_FILE.test(name)) found.push(path.join(folder, name));
  }
  return found.sort();
}
