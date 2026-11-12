// Positive fixture for LP001 (positive evidence, severity "high"): an existence check BEFORE the
// risky code rules out the expected failure ("it isn't there"), so the empty catch can only
// swallow unexpected errors (a corrupt file, missing permissions, a bug).
// Each catch below must be reported with severity "high", confidence "high".

import { existsSync, readFileSync, statSync } from "node:fs";

declare const cache: Map<string, string>;
declare function parse(text: string): unknown;

// An `if` around the try checks the same file that the try reads.
export function loadSettings(file: string): unknown {
  let settings: unknown = {};
  if (existsSync(file)) {
    try {
      settings = parse(readFileSync(file, "utf8"));
    } catch {}
  }
  return settings;
}

// The check is the first statement inside the try.
export function loadManifest(file: string): unknown {
  try {
    if (existsSync(file)) {
      return parse(readFileSync(file, "utf8"));
    }
  } catch {}
  return undefined;
}

// An early exit before the try: if the key is not there, the try is never reached.
export function loadCached(key: string): unknown {
  if (!cache.has(key)) return undefined;
  let value: unknown;
  try {
    value = parse(cache.get(key) as string);
  } catch {}
  return value;
}

// An early exit as the first statement inside the try.
export function loadPlugin(dir: string): unknown {
  try {
    if (!existsSync(dir)) return undefined;
    return parse(readFileSync(`${dir}/plugin.json`, "utf8"));
  } catch {}
  return undefined;
}

// The `in` operator checks that the key exists.
export function readOption(options: Record<string, string>, key: string): unknown {
  if (key in options) {
    try {
      return parse(options[key]);
    } catch {}
  }
  return undefined;
}

// A stat check on the same folder.
export function listFolder(dir: string, list: (dir: string) => string[]): string[] {
  let names: string[] = [];
  if (statSync(dir).isDirectory()) {
    try {
      names = list(dir);
    } catch {}
  }
  return names;
}
