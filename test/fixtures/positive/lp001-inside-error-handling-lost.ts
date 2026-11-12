// Positive fixture for LP001 (rule 2 must NOT apply): empty catches inside another catch
// block, but the outer error is NOT passed on, or the inner code runs at another time.
// Each inner empty catch must still be reported with severity "high", confidence "high".

declare function compile(file: string): string;
declare function cleanup(): void;
declare const logger: { info(message: string): void };

// The outer error is only inspected and turned into text: nothing passes it on.
export function build(file: string): string | undefined {
  try {
    return compile(file);
  } catch (e) {
    try {
      cleanup();
    } catch {}
    if (e instanceof TypeError) logger.info(`build failed: ${(e as Error).message}`);
    return undefined;
  }
}

// The outer catch keeps no variable, so it has no error to pass on.
export function buildQuietly(file: string): void {
  try {
    compile(file);
  } catch {
    try {
      cleanup();
    } catch {}
  }
}

// The inner try runs later, in a callback, not while the outer error is being handled.
export function buildLater(file: string): void {
  try {
    compile(file);
  } catch (e) {
    setTimeout(() => {
      try {
        cleanup();
      } catch {}
    }, 0);
    throw e;
  }
}
