// Negative fixture for LP001: catch blocks that return an explicit fallback value.
// Not reported: the block contains a deliberate decision that is visible in the code.
// (Whether a silent fallback hides failures is a separate, future check.)

declare function loadPlugins(): string[];
declare function readPort(): number;

export function plugins(): string[] {
  try {
    return loadPlugins();
  } catch {
    return [];
  }
}

export function port(): number | null {
  try {
    return readPort();
  } catch (err) {
    return null;
  }
}
