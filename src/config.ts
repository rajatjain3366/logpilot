// Config file: finds, reads and checks logpilot.config.json. It only reads files.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { checkExcludePattern } from "./file-selection.js";
import {
  DEFAULT_FAIL_ON,
  DEFAULT_MIN_SEVERITY,
  FAIL_ON_LEVELS,
  type FailOn,
  isFailOn,
  isSeverity,
  SEVERITIES,
} from "./severity.js";
import type { Severity } from "./types.js";

export const CONFIG_FILE_NAME = "logpilot.config.json";

/** The settings a config file can contain, with their defaults filled in. */
export interface Config {
  /** Glob patterns of files and folders not to scan, relative to the config file's folder. */
  exclude: string[];
  /** Skip default folders, minified and vendored files (see file-selection.ts). */
  defaultExcludes: boolean;
  /** Show only findings at or above this severity. */
  minSeverity: Severity;
  /** Exit with code 1 when a finding is at or above this severity ("none": never). */
  failOn: FailOn;
}

/** The settings LogPilot knows. Anything else is an error, so a typo such as "excludes" is caught. */
const KNOWN_SETTINGS = ["exclude", "defaultExcludes", "minSeverity", "failOn"];

/** A config file that cannot be used. The CLI prints the message and exits with code 2. */
export class ConfigError extends Error {}

/**
 * Finds the config file for a scan of `target` (a folder, or a file whose folder is used).
 * It looks in that folder, then in each parent folder, but never above the repository root:
 * the first folder (going up) that contains `.git`. Outside a repository, only the target's own
 * folder is checked, so a stray config file somewhere above is never used by accident.
 */
export function findConfigFile(target: string): string | undefined {
  const start = isDirectory(target) ? target : path.dirname(target);
  const lastFolder = findRepositoryRoot(start) ?? start;
  for (let dir = start; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, CONFIG_FILE_NAME);
    if (isFile(candidate)) return candidate;
    if (dir === lastFolder || path.dirname(dir) === dir) return undefined;
  }
}

/**
 * The nearest folder, going up from `start`, that contains `.git`. Usually `.git` is a folder;
 * in git worktrees and submodules it is a small file, which also marks the repository root.
 */
export function findRepositoryRoot(start: string): string | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (statSync(path.join(dir, ".git"), { throwIfNoEntry: false })) return dir;
    if (path.dirname(dir) === dir) return undefined; // reached the top of the drive
  }
}

/**
 * Reads and checks a config file. `shownAs` is how the file is named in error messages.
 * Throws ConfigError when the file cannot be read, is not valid JSON, or has unknown or wrong settings.
 */
export function loadConfig(file: string, shownAs: string = file): Config {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigError(`${shownAs}: cannot be read (${(error as Error).message})`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${shownAs}: is not valid JSON (${(error as Error).message})`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError(`${shownAs}: must contain a JSON object, for example { "exclude": ["docs/**"] }`);
  }

  const settings = data as Record<string, unknown>;
  for (const key of Object.keys(settings)) {
    if (!KNOWN_SETTINGS.includes(key)) {
      throw new ConfigError(`${shownAs}: unknown setting "${key}" (known settings: ${KNOWN_SETTINGS.join(", ")})`);
    }
  }
  if (settings.defaultExcludes !== undefined && typeof settings.defaultExcludes !== "boolean") {
    throw new ConfigError(`${shownAs}: "defaultExcludes" must be true or false`);
  }
  const exclude = settings.exclude ?? [];
  if (!Array.isArray(exclude) || !exclude.every((pattern) => typeof pattern === "string")) {
    throw new ConfigError(`${shownAs}: "exclude" must be a list of patterns, for example ["docs/**"]`);
  }
  for (const pattern of exclude) {
    const problem = checkExcludePattern(pattern);
    if (problem !== undefined) throw new ConfigError(`${shownAs}: exclude pattern "${pattern}": ${problem}`);
  }
  const minSeverity = settings.minSeverity ?? DEFAULT_MIN_SEVERITY;
  if (!isSeverity(minSeverity)) {
    throw new ConfigError(`${shownAs}: "minSeverity" must be one of ${SEVERITIES.join(", ")}`);
  }
  const failOn = settings.failOn ?? DEFAULT_FAIL_ON;
  if (!isFailOn(failOn)) {
    throw new ConfigError(`${shownAs}: "failOn" must be one of ${FAIL_ON_LEVELS.join(", ")}`);
  }
  return { exclude, defaultExcludes: (settings.defaultExcludes as boolean | undefined) ?? true, minSeverity, failOn };
}

function isDirectory(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function isFile(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
}
