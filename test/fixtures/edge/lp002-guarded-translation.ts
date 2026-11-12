// Edge fixture for LP002: the catch checks WHICH error it caught, then replaces it with a
// clearer one. Often deliberate, but the original stack and details are still dropped.
// Each `throw new ...` must be reported with severity "low", confidence "medium" (case A4).
// The final `throw err` in each catch is fine.

class NotFoundError extends Error {}
class ConflictError extends Error {}
class UniqueViolationError extends Error {}
declare function readFile(path: string): string;
declare function insertUser(name: string): void;

export function readDocument(path: string): string {
  try {
    return readFile(path);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new NotFoundError(`No document at ${path}`);
    }
    throw err;
  }
}

export function createUser(name: string): void {
  try {
    insertUser(name);
  } catch (err) {
    if (err instanceof UniqueViolationError) throw new ConflictError("User already exists");
    throw err;
  }
}

export function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err: any) {
    switch (err.code) {
      case "E_EMPTY":
        throw new Error("Nothing to parse");
      default:
        throw err;
    }
  }
}
