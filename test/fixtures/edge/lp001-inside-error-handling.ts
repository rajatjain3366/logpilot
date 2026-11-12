// Edge fixture for LP001 (rule 2): an empty catch inside ANOTHER catch block whose error is
// still passed on. Losing the secondary failure costs little: the main error survives.
// Each inner empty catch must be reported with severity "low", confidence "high".

import { readFileSync } from "node:fs";

interface CompileError extends Error {
  frame?: string;
}
declare function compile(file: string): string;
declare function codeFrame(source: string): string;
declare function cleanup(): void;
declare function reportFailure(err: unknown): void;

// Adds a code frame to the error if it can, then rethrows the original error.
export function build(file: string): string {
  try {
    return compile(file);
  } catch (e) {
    const error = e as CompileError;
    try {
      error.frame = codeFrame(readFileSync(file, "utf8"));
    } catch {}
    throw e;
  }
}

// Best-effort cleanup, then the original error is handed to a reporter.
export function run(file: string): void {
  try {
    compile(file);
  } catch (err) {
    try {
      cleanup();
    } catch {}
    reportFailure(err);
  }
}
