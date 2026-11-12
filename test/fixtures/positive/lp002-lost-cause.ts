// Positive fixture for LP002: a catch block throws a NEW error and drops the one it caught.
// Each throw below must be reported with severity "high", confidence "high" (case P1).
// (No comments inside the catch blocks: a comment there lowers confidence on purpose.)

import { readFileSync } from "node:fs";

class DatabaseError extends Error {}
declare const db: { query(sql: string, params: unknown[]): Promise<unknown[]> };

export function loadConfig(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error("Failed to load config");
  }
}

export async function findUser(id: string): Promise<unknown> {
  try {
    const rows = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0];
  } catch (error) {
    throw new DatabaseError(`Could not load user ${id}`);
  }
}

// Error() called without `new` also creates a new error.
export function parsePort(value: string): number {
  try {
    return JSON.parse(value);
  } catch (e) {
    throw Error("Invalid port");
  }
}

// A new error with no message, and not even parentheses.
export function connect(open: () => void): void {
  try {
    open();
  } catch (err) {
    throw new Error;
  }
}
