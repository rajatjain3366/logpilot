// Positive fixture for LP002: the catch keeps no usable variable for the error, so the new
// error cannot carry it. Each throw must be reported with severity "high", confidence
// "medium" (case A3: dropping the error may be deliberate here).

declare function readFile(path: string): string;

export function readTemplate(path: string): string {
  try {
    return readFile(path);
  } catch {
    throw new Error(`Template ${path} could not be read`);
  }
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFile(path));
  } catch ({ message }) {
    throw new SyntaxError(`Invalid JSON in ${path}: ${message}`);
  }
}

export function readOptional(path: string): string {
  try {
    return readFile(path);
  } catch (_err) {
    throw new Error("Optional file is missing");
  }
}
