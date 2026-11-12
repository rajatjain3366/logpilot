// Positive fixture for LP002: the caught error is passed as Error's SECOND argument.
// That argument is an options object ({ cause }), so the error is silently lost.
// Each throw below must be reported with severity "high", confidence "high" (case P3).

declare function fetchJson(url: string): Promise<unknown>;

export async function getProfile(url: string): Promise<unknown> {
  try {
    return await fetchJson(url);
  } catch (err: any) {
    throw new Error("Failed to fetch profile", err);
  }
}

export function toNumber(text: string): number {
  try {
    return JSON.parse(text);
  } catch (parseError) {
    throw new TypeError("Expected a number", parseError as Error);
  }
}
