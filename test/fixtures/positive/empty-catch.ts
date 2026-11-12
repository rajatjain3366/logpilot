// Positive fixture for LP001: completely empty catch blocks.
// Each catch below must be reported with confidence "high".

import { readFileSync } from "node:fs";

export function loadConfig(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {}
  return undefined;
}

export function cleanup(remove: () => void): void {
  try {
    remove();
  } catch {}
}

export async function sendEmail(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
  }
}
