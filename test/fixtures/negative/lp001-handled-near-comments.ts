// Negative fixture for LP001 (rules 1 and 2): comments and nested catches never create a
// finding by themselves. Catch blocks that handle their error are not reported.
// Must NOT be reported by any rule.

declare function compile(file: string): string;
declare function cleanup(): void;
declare const logger: { debug(details: object, message: string): void };

export function build(file: string): string {
  // Compilation may fail; the caller decides what to do.
  try {
    return compile(file);
  } catch (e) {
    try {
      cleanup();
    } catch (cleanupError) {
      logger.debug({ err: cleanupError }, "cleanup failed");
    }
    throw e;
  }
}
