// Edge fixture for LP001 (rule 1): a comment next to the empty catch explains why the error
// is ignored. Each catch below: severity "medium" (a comment does not lower it), confidence "medium".

declare function readCache(): string;
declare function parseOrigin(value: string): URL;
declare function closeSocket(): void;
declare function compareTokens(a: string, b: string): boolean;

// A comment inside the try block, on its own line.
export function cached(): string | undefined {
  let value: string | undefined;
  try {
    // the cache is optional: a missing cache file is normal
    value = readCache();
  } catch {}
  return value;
}

// A comment at the end of a line inside the try block.
export function origin(value: string): string | undefined {
  try {
    return parseOrigin(value).hostname; // placeholders such as "<origin>" are not valid URLs
  } catch {}
  return undefined;
}

// Comments on the lines directly above the try.
export function close(): void {
  // Closing an already-closed socket throws; that is fine here,
  // and nothing else can go wrong in closeSocket().
  try {
    closeSocket();
  } catch {}
}

// A comment right after the catch's closing brace, on the same line.
export function sameToken(a: string, b: string): boolean {
  try {
    return compareTokens(a, b);
  } catch {} // throws when the lengths differ, which means "not the same"
  return false;
}
