// Edge fixture for LP002: no usable variable (case A3) combined with other cases.
//   - `_err` whose message is copied (P2 + A3)        -> severity "medium", confidence "medium"
//   - `_err` logged first, then a new error (A1 + A3) -> severity "low",    confidence "medium"

declare const logger: { error(details: object, message: string): void };
declare function readFile(path: string): string;

export function readTemplate(path: string): string {
  try {
    return readFile(path);
  } catch (_err) {
    throw new Error(`Template ${path} could not be read: ${(_err as Error).message}`);
  }
}

export function readPartial(path: string): string {
  try {
    return readFile(path);
  } catch (_err) {
    logger.error({ err: _err }, "partial could not be read");
    throw new Error(`Partial ${path} could not be read`);
  }
}
