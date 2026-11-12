// Negative fixture for LP001: a guarded try whose catch handles the error.
// Must NOT be reported by any rule.

import { existsSync, readFileSync } from "node:fs";

declare const logger: { warn(details: object, message: string): void };

export function loadSettings(file: string): unknown {
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      logger.warn({ err, file }, "settings file is not valid JSON; using defaults");
    }
  }
  return {};
}
