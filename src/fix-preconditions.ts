// The checks `logpilot fix` makes before it may change a file. A file that fails one is never
// changed: its fixes are listed with the reason and not even asked about. Nothing here writes.
//
// The run as a whole needs a git repository, so that every change can be undone with git
// (`git checkout -- <file>`). Each file must then be:
//   - inside the scanned folder, and not reached through a symbolic link or junction;
//   - a regular file with one name (no hard links: replacing it would split the names), not read-only;
//   - valid UTF-8 (a Latin-1 or UTF-16 file could be damaged by rewriting it);
//   - tracked by git, with no changes, staged or not ("commit or stash first");
//   - restorable byte for byte: `git checkout` would give back exactly its current bytes. With
//     core.autocrlf=true, a file with LF or mixed line endings is "clean" for git but would come
//     back with CRLF (measured in Milestone 4's spike), so an undo would not be exact.

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { changedFiles, checkoutBytes, GitError, type IndexEntry, indexEntries, repositoryRoot } from "./git.js";

/** What `logpilot fix` knows about the git repository it works in. */
export interface Repository {
  root: string;
  /** Tracked files: path relative to the root, with "/" -> index entry. */
  index: Map<string, IndexEntry>;
  /** Tracked files with changes: path relative to the root, with "/" -> git's two-letter status. */
  changed: Map<string, string>;
  /** Tests only: the git program to run. */
  program?: string;
}

/** The repository for a scan of `scanRoot`, or why `logpilot fix` cannot run there. */
export function openRepository(scanRoot: string, program?: string): { ok: true; repository: Repository } | { ok: false; reason: string } {
  try {
    const root = repositoryRoot(scanRoot, program);
    if (root === undefined) {
      return {
        ok: false,
        reason:
          "this folder is not in a git repository. logpilot fix only changes files that git can restore, so every " +
          "change can be undone (git init, then commit your files, and run it again)",
      };
    }
    return { ok: true, repository: { root, index: indexEntries(root, program), changed: changedFiles(root, program), program } };
  } catch (error) {
    if (error instanceof GitError) return { ok: false, reason: error.message };
    throw error;
  }
}

/** A file that passed every check, with the exact bytes and text that were checked. */
export interface FixTarget {
  absolutePath: string;
  /** Relative to the repository root, with "/": what `git checkout -- <path>` needs from the root. */
  repositoryPath: string;
  bytes: Buffer;
  /** The bytes decoded as UTF-8 (a byte order mark stays as U+FEFF, so offsets match the scan). */
  text: string;
}

/** Checks one file. Returns the file's bytes and text when it may be changed, or why not. */
export function checkFile(absolutePath: string, scanRoot: string, repository: Repository): { ok: true; target: FixTarget } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });

  const relative = path.relative(scanRoot, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return no("it is outside the scanned folder");
  // Every step from the scanned folder down to the file must be a real folder or file: a symbolic
  // link or junction would make the write land somewhere else.
  let step = scanRoot;
  for (const part of relative.split(path.sep)) {
    step = path.join(step, part);
    try {
      if (lstatSync(step).isSymbolicLink()) return no("it is reached through a symbolic link or junction");
    } catch (error) {
      return no(`it could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`);
    }
  }

  const stats = lstatSync(absolutePath);
  if (!stats.isFile()) return no("it is not a regular file");
  if (stats.nlink > 1) return no("it has more than one name (a hard link); replacing it would separate the names");
  if ((stats.mode & 0o200) === 0) return no("it is read-only (LogPilot never changes file permissions)");

  let bytes: Buffer;
  let text: string;
  try {
    bytes = readFileSync(absolutePath);
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_ENCODING_INVALID_ENCODED_DATA") {
      return no("it is not valid UTF-8 (for example Latin-1 or UTF-16), so rewriting it could damage it");
    }
    return no(`it could not be read (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`);
  }
  if (!Buffer.from(text, "utf8").equals(bytes)) return no("its bytes do not survive decoding and encoding as UTF-8 unchanged");

  const fromRoot = path.relative(repository.root, absolutePath);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return no("it is outside the git repository");
  const repositoryPath = fromRoot.split(path.sep).join("/");
  const entry = repository.index.get(repositoryPath);
  if (entry === undefined) {
    return no("git does not track it (a new or ignored file, or a file of another repository such as a submodule): commit it first");
  }
  if (entry.mode === "conflict") return no("it has an unresolved merge conflict");
  if (entry.mode !== "100644" && entry.mode !== "100755") return no(`git does not store it as a regular file (mode ${entry.mode})`);
  const status = repository.changed.get(repositoryPath);
  if (status !== undefined) return no(`it has changes that are not committed (git status: "${status.trim()}"): commit or stash them first`);

  let restorable: Buffer;
  try {
    restorable = checkoutBytes(repository.root, repositoryPath, entry.blob, repository.program);
  } catch (error) {
    if (error instanceof GitError) return no(error.message);
    throw error;
  }
  if (!restorable.equals(bytes)) {
    return no(
      "git would not give back this file byte for byte (its line endings, or another git setting such as " +
        "core.autocrlf or .gitattributes, differ from what git writes on checkout), so an undo with git would not be exact",
    );
  }
  return { ok: true, target: { absolutePath, repositoryPath, bytes, text } };
}
