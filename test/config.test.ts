// Tests for src/config.ts: finding, reading and checking logpilot.config.json.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, findConfigFile, findRepositoryRoot, loadConfig } from "../src/config.js";

let tmp: string;

/** Creates files (and their folders) under the temp folder. A name ending in "/" creates just a folder. */
function create(...relativePaths: string[]): void {
  for (const relativePath of relativePaths) {
    const full = path.join(tmp, relativePath);
    if (relativePath.endsWith("/")) {
      mkdirSync(full, { recursive: true });
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, "{}");
    }
  }
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "logpilot-config-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("findConfigFile inside a repository (a folder with .git)", () => {
  it("walks up from the scanned folder to the repository root", () => {
    create("repo/.git/", "repo/logpilot.config.json", "repo/packages/app/src/");

    expect(findConfigFile(path.join(tmp, "repo/packages/app"))).toBe(path.join(tmp, "repo/logpilot.config.json"));
  });

  it("ignores a stray config file ABOVE the repository root", () => {
    create("logpilot.config.json", "repo/.git/", "repo/packages/app/");

    expect(findConfigFile(path.join(tmp, "repo/packages/app"))).toBeUndefined();
  });

  it("uses the nearest config file when there are several", () => {
    create("repo/.git/", "repo/logpilot.config.json", "repo/packages/app/logpilot.config.json");

    expect(findConfigFile(path.join(tmp, "repo/packages/app"))).toBe(
      path.join(tmp, "repo/packages/app/logpilot.config.json"),
    );
  });

  it("starts from the file's folder when a single file is scanned", () => {
    create("repo/.git/", "repo/logpilot.config.json", "repo/src/app.js");

    expect(findConfigFile(path.join(tmp, "repo/src/app.js"))).toBe(path.join(tmp, "repo/logpilot.config.json"));
  });

  it("also treats a .git FILE (git worktrees, submodules) as the repository root", () => {
    create("logpilot.config.json", "worktree/.git", "worktree/src/");

    expect(findRepositoryRoot(path.join(tmp, "worktree/src"))).toBe(path.join(tmp, "worktree"));
    expect(findConfigFile(path.join(tmp, "worktree/src"))).toBeUndefined(); // the stray one above is ignored
  });
});

describe("findConfigFile outside any repository", () => {
  it("checks only the scanned folder itself", () => {
    // Precondition: the system temp folder must not be inside a git repository, or this test means nothing.
    expect(findRepositoryRoot(tmp), "the temp folder is inside a git repository").toBeUndefined();
    create("project/logpilot.config.json", "project/sub/");

    expect(findConfigFile(path.join(tmp, "project"))).toBe(path.join(tmp, "project/logpilot.config.json"));
    expect(findConfigFile(path.join(tmp, "project/sub"))).toBeUndefined(); // the parent's file is NOT used
  });
});

describe("loadConfig", () => {
  /** Writes `text` as a config file and loads it. */
  function load(text: string) {
    const file = path.join(tmp, "logpilot.config.json");
    writeFileSync(file, text);
    return loadConfig(file, "logpilot.config.json");
  }

  it("reads the settings, and fills in defaults for missing ones", () => {
    expect(load('{ "exclude": ["docs/**"], "defaultExcludes": false, "minSeverity": "medium", "failOn": "high" }')).toEqual({
      exclude: ["docs/**"],
      defaultExcludes: false,
      minSeverity: "medium",
      failOn: "high",
    });
    expect(load("{}")).toEqual({ exclude: [], defaultExcludes: true, minSeverity: "low", failOn: "none" });
  });

  it.each([
    ["{ not json", "logpilot.config.json: is not valid JSON ("],
    ["[]", 'logpilot.config.json: must contain a JSON object, for example { "exclude": ["docs/**"] }'],
    ['"text"', "logpilot.config.json: must contain a JSON object"],
    [
      '{ "excludes": [] }',
      'logpilot.config.json: unknown setting "excludes" (known settings: exclude, defaultExcludes, minSeverity, failOn)',
    ],
    ['{ "minSeverity": "critical" }', 'logpilot.config.json: "minSeverity" must be one of low, medium, high'],
    ['{ "failOn": "always" }', 'logpilot.config.json: "failOn" must be one of none, low, medium, high'],
    ['{ "defaultExcludes": "no" }', 'logpilot.config.json: "defaultExcludes" must be true or false'],
    ['{ "exclude": "docs/**" }', 'logpilot.config.json: "exclude" must be a list of patterns, for example ["docs/**"]'],
    ['{ "exclude": ["!src/keep.js"] }', 'exclude pattern "!src/keep.js": patterns that start with "!" (exceptions) are not supported'],
    ['{ "exclude": ["docs\\\\**"] }', 'exclude pattern "docs\\**": use "/" in patterns, also on Windows'],
    ['{ "exclude": ["/docs/**"] }', 'exclude pattern "/docs/**": patterns are relative to the project folder'],
  ])("rejects %s with a clear message", (text, message) => {
    expect(() => load(text)).toThrow(ConfigError);
    expect(() => load(text)).toThrow(message);
  });
});
