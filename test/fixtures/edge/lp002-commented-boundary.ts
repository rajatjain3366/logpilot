// Edge fixture for LP002: a comment says the details are hidden from API clients on purpose.
// Must be reported with severity "high", confidence "medium" (case A2).
// Note: attaching { cause: err } would NOT show the details to clients (a cause is not in
// JSON.stringify output or in error.stack); the error handler decides what clients see.

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
declare function runQuery(sql: string): Promise<unknown>;

export async function handleRequest(): Promise<unknown> {
  try {
    return await runQuery("SELECT 1");
  } catch (err) {
    // Don't leak database details to API clients.
    throw new HttpError(500, "Internal server error");
  }
}
