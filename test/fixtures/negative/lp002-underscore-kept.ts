// Negative fixture for LP002: a variable named like "unused" (`_err`) that IS passed on as the
// cause. Must NOT be reported by any rule.

declare function readFile(path: string): string;

export function readTemplate(path: string): string {
  try {
    return readFile(path);
  } catch (_err) {
    throw new Error(`Template ${path} could not be read`, { cause: _err });
  }
}
