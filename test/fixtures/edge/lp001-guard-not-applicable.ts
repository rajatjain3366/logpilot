// Edge fixture for LP001: checks that do NOT count as positive evidence. Each catch below must
// be reported with the default severity "medium", confidence "high".

import { existsSync, mkdirSync, readFileSync } from "node:fs";

declare function parse(text: string): unknown;

// The check is about a different file than the one the try reads.
export function loadOther(file: string, other: string): unknown {
  if (existsSync(file)) {
    try {
      return parse(readFileSync(other, "utf8"));
    } catch {}
  }
  return undefined;
}

// A negated check: the try runs exactly when the folder is NOT there.
export function createFolder(dir: string): void {
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir);
    } catch {}
  }
}

// The try is in the else branch, where the check failed.
export function readBackup(file: string): string | undefined {
  if (existsSync(file)) {
    return readFileSync(file, "utf8");
  } else {
    try {
      return readFileSync(`${file}.bak`, "utf8");
    } catch {}
  }
  return undefined;
}

// A plain flag is not an existence check.
export function maybeLoad(enabled: boolean, file: string): unknown {
  if (enabled) {
    try {
      return parse(readFileSync(file, "utf8"));
    } catch {}
  }
  return undefined;
}

// A comparison is not counted: here the try runs when the file is missing.
export function loadWhenMissing(file: string): unknown {
  if (existsSync(file) === false) {
    try {
      return parse(readFileSync(`${file}.default`, "utf8"));
    } catch {}
  }
  return undefined;
}

// A negated check that does not leave: the try still runs when the file is missing.
export function loadWithWarning(file: string, warn: (message: string) => void): unknown {
  if (!existsSync(file)) warn("missing settings file");
  try {
    return parse(readFileSync(file, "utf8"));
  } catch {}
  return undefined;
}
