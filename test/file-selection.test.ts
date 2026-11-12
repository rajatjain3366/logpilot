// Tests for src/file-selection.ts: which folders and files a scan skips, and why.

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkExcludePattern,
  ExcludePatterns,
  fileSkipByContent,
  fileSkipByName,
  folderSkip,
  isDotBuildFolder,
} from "../src/file-selection.js";
import { nameWords } from "../src/names.js";
import { unsupportedNodeVersion } from "../src/node-version.js";

describe("checkExcludePattern", () => {
  it.each(["docs/**", "**/*.generated.js", "scripts", "test/{fixtures,data}/**"])("accepts %s", (pattern) => {
    expect(checkExcludePattern(pattern)).toBeUndefined();
  });

  it.each([
    ["", "a pattern cannot be empty"],
    ["!src/keep.js", 'patterns that start with "!" (exceptions) are not supported'],
    ["docs\\**", 'use "/" in patterns, also on Windows'],
    ["/docs/**", "patterns are relative to the project folder; remove the leading / or drive letter"],
    ["C:/project/docs/**", "patterns are relative to the project folder; remove the leading / or drive letter"],
  ])("rejects %j", (pattern, problem) => {
    expect(checkExcludePattern(pattern)).toBe(problem);
  });
});

describe("ExcludePatterns", () => {
  const root = path.resolve("project");
  const at = (relative: string) => path.join(root, ...relative.split("/"));

  it("matches paths relative to the project folder, with / separators on every OS", () => {
    const excludes = new ExcludePatterns(["docs/**", "**/*.generated.js", "*.config.js"], root);

    expect(excludes.match(at("docs/guide/intro.js"), "file")).toBe("docs/**");
    expect(excludes.match(at("src/api/client.generated.js"), "file")).toBe("**/*.generated.js");
    expect(excludes.match(at("vite.config.js"), "file")).toBe("*.config.js");
    expect(excludes.match(at("src/vite.config.js"), "file")).toBeUndefined(); // "*" does not cross folders; use "**/"
    expect(excludes.match(at("src/app.js"), "file")).toBeUndefined();
  });

  it("matches a folder itself for 'docs/**' and 'docs', so it is not entered at all", () => {
    expect(new ExcludePatterns(["docs/**"], root).match(at("docs"), "folder")).toBe("docs/**");
    expect(new ExcludePatterns(["docs"], root).match(at("docs"), "folder")).toBe("docs");
    expect(new ExcludePatterns(["**/fixtures/**"], root).match(at("test/fixtures"), "folder")).toBe("**/fixtures/**");
    expect(new ExcludePatterns(["docs/**"], root).match(at("docs"), "file")).toBeUndefined(); // a FILE named docs
  });

  it("does not match folders whose name starts with a dot unless the pattern names them", () => {
    expect(new ExcludePatterns(["**/*.js"], root).match(at(".github/scripts/release.js"), "file")).toBeUndefined();
    expect(new ExcludePatterns([".github/**"], root).match(at(".github/scripts/release.js"), "file")).toBe(".github/**");
  });

  it("never matches anything outside the project folder", () => {
    expect(new ExcludePatterns(["**"], root).match(path.resolve("elsewhere", "a.js"), "file")).toBeUndefined();
  });

  it("reports the patterns that never matched", () => {
    const excludes = new ExcludePatterns(["docs/**", "doc/**"], root);
    excludes.match(at("docs/a.js"), "file");

    expect(excludes.unused()).toEqual(["doc/**"]);
  });
});

describe("unsupportedNodeVersion", () => {
  it.each(["22.20.0", "22.23.4", "v24.8.0", "24.22.2", "25.1.0"])("accepts Node %s", (version) => {
    expect(unsupportedNodeVersion(version)).toBeUndefined();
  });

  it.each(["20.18.0", "22.19.0", "23.11.0", "24.7.0"])("rejects Node %s with a clear message", (version) => {
    expect(unsupportedNodeVersion(version)).toBe(
      `LogPilot needs Node.js 22.20 or newer (on Node 24: 24.8 or newer); this is Node.js ${version}`,
    );
  });
});

describe("folderSkip", () => {
  it.each([
    ["node_modules", "dependencies, never scanned"],
    [".git", "git internals, never scanned"],
    ["vendor", "third-party code"],
    ["bower_components", "third-party code"],
    ["dist", "generated output"],
    ["build", "generated output"],
    ["coverage", "generated output"],
    [".next", "generated output"],
  ])("skips %s (%s)", (name, detail) => {
    expect(folderSkip(name)).toEqual({ reason: "default-folder", detail });
  });

  it.each(["src", "lib", "docs", "public", "test", "builder", "distribution"])("enters %s", (name) => {
    expect(folderSkip(name)).toBeUndefined();
  });

  it("with default excludes off, still skips node_modules and .git, but enters the others", () => {
    expect(folderSkip("node_modules", false)?.detail).toBe("dependencies, never scanned");
    expect(folderSkip(".git", false)?.detail).toBe("git internals, never scanned");
    expect(folderSkip("dist", false)).toBeUndefined();
    expect(folderSkip("vendor", false)).toBeUndefined();
    expect(folderSkip(".yarn", false)).toBeUndefined(); //         (v0.4.1)
    expect(folderSkip(".server-build", false)).toBeUndefined();
  });
});

describe("folderSkip: dot-named build, cache and third-party folders (v0.4.1)", () => {
  it.each([
    ".angular", ".astro", ".aws-sam", ".cache", ".docusaurus", ".esbuild", ".expo", ".firebase", ".netlify", ".nx",
    ".parcel-cache", ".serverless", ".turbo", ".vercel", ".vinxi", ".vite", ".webpack", ".wrangler",
  ])("skips the tool folder %s as generated output", (name) => {
    expect(folderSkip(name)).toMatchObject({ reason: "default-folder", detail: expect.stringMatching(/^generated output \(/) });
  });

  it("applies the build-word rule only to names that start with a dot", () => {
    expect(isDotBuildFolder(".server-build")).toBe(true);
    expect(isDotBuildFolder("server-build")).toBe(false);
    expect(isDotBuildFolder(".")).toBe(false);
  });

  it("skips .yarn as third-party code (Yarn 2+ keeps its own release and plugins there)", () => {
    expect(folderSkip(".yarn")).toEqual({ reason: "default-folder", detail: "third-party code (Yarn's own release and plugins)" });
  });

  it.each([".server-build", ".build", ".dist", ".out", ".remix-cache", ".serverBuild", ".my_dist", ".app.output"])(
    "skips %s: a dot-named folder whose last word is build, dist, out, output or cache",
    (name) => {
      expect(folderSkip(name)).toEqual({ reason: "default-folder", detail: "generated output (a dot-named build folder)" });
    },
  );

  // Dot folders seen in the evaluated projects that hold the projects' own code or config, and
  // look-alikes whose last word only contains a build word.
  it.each([".github", ".vitepress", ".storybook", ".husky", ".vscode", ".devcontainer", ".evergreen", ".claude", ".config",
    ".nested", ".hidden-dir", ".dot-prefixed", ".layout", ".builders", ".build-tools", ".distribution", ".outbox", "server-build"])(
    "enters %s",
    (name) => {
      expect(folderSkip(name)).toBeUndefined();
    },
  );
});

describe("nameWords", () => {
  it.each([
    ["newPassword", ["new", "password"]],
    ["password_confirmation", ["password", "confirmation"]],
    ["x-api-key", ["x", "api", "key"]],
    ["APIKey", ["api", "key"]],
    ["server-build", ["server", "build"]],
    ["serverBuild", ["server", "build"]],
    ["s3Secret", ["s", "secret"]],
  ])("splits %s into %j", (name, words) => {
    expect(nameWords(name)).toEqual(words);
  });
});

describe("fileSkipByName", () => {
  it.each(["jquery.min.js", "app.min.mjs", "lib.MIN.cjs"])("skips %s as minified", (name) => {
    expect(fileSkipByName(name)?.reason).toBe("minified-name");
  });

  it("names the extension it saw", () => {
    expect(fileSkipByName("app.min.mjs")?.detail).toBe("minified: the file name ends in .min.mjs");
  });

  it.each(["app.js", "admin.js", "min.js", "terminal.ts", "app.min.ts"])("does not skip %s", (name) => {
    expect(fileSkipByName(name)).toBeUndefined();
  });
});

describe("fileSkipByContent", () => {
  it("skips a file that starts with a /*! license comment naming a version (a vendored library)", () => {
    const jquery = "/*!\n * jQuery JavaScript Library v1.10.2\n * http://jquery.com/\n */\n(function (window) {\n  try { x(); } catch (e) {}\n})(this);\n";

    expect(fileSkipByContent(jquery)).toEqual({
      reason: "vendored-banner",
      detail: "vendored: starts with a /*! license comment that names a version",
    });
    expect(fileSkipByContent("/*! lib | @version 2.3.1 */\nvar a = 1;\n")?.reason).toBe("vendored-banner");
    expect(fileSkipByContent("﻿\n\n/*! tool v3.0 */\nvar a;\n")?.reason).toBe("vendored-banner"); // BOM + blank lines
  });

  it("scans a project's own file that starts with a /*! banner WITHOUT a version (Express and Mongoose do this)", () => {
    const expressStyle = "/*!\n * express\n * Copyright(c) 2009-2013 TJ Holowaychuk\n * MIT Licensed\n */\n\n'use strict';\n";

    expect(fileSkipByContent(expressStyle)).toBeUndefined();
  });

  it("only looks at a /*! comment at the very start, and only at /*! comments", () => {
    expect(fileSkipByContent("'use strict';\n/*! lib v1.2.3 */\n")).toBeUndefined();
    expect(fileSkipByContent("/* lib v1.2.3 (an ordinary comment) */\nvar a;\n")).toBeUndefined();
  });

  it("skips a minified file: long average line AND a line over 1,000 characters", () => {
    const minified = "!function(){" + "var a=1;".repeat(400) + "}();\n";

    expect(fileSkipByContent(minified)).toEqual({
      reason: "minified-content",
      detail: "minified: lines average 1608 characters and the longest has 3216",
    });
  });

  it("scans a file of long string lines without a 1,000-character line (like a list of test names)", () => {
    const longStrings = Array.from({ length: 50 }, (_, i) => `  '${"flaky test name ".repeat(9)}${i}',`).join("\n"); // ~150 characters per line

    expect(longStrings.length / 50).toBeGreaterThan(110); // long lines on average...
    expect(fileSkipByContent(longStrings)).toBeUndefined(); // ...but no minified-length line
  });

  it("scans a normal file with one very long line (a data URL), because the average stays low", () => {
    const code = Array.from({ length: 100 }, () => "const x = compute(1);").join("\n") + `\nconst img = "${"A".repeat(5000)}";\n`;

    expect(fileSkipByContent(code)).toBeUndefined();
  });
});
