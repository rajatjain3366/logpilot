// Negative fixture for LP001: catch blocks that rethrow the error. Must NOT be reported.

declare function fetchUser(id: string): Promise<unknown>;
declare function readFile(path: string): string;

export async function getUser(id: string): Promise<unknown> {
  try {
    return await fetchUser(id);
  } catch (err) {
    throw new Error(`Failed to fetch user ${id}`, { cause: err });
  }
}

export function readRequired(path: string): string {
  try {
    return readFile(path);
  } catch (err) {
    throw err;
  }
}

// Nested: the inner catch rethrows, the outer catch logs. Neither block is empty.
export function readNested(path: string): string | undefined {
  try {
    try {
      return readFile(path);
    } catch (inner) {
      throw new Error("inner read failed", { cause: inner });
    }
  } catch (outer) {
    console.warn("nested read failed", outer);
    return undefined;
  }
}
