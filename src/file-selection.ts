// File selection: decides which folders and files a scan skips, and why.
// Every decision here is reported (see "Not scanned" in the summary and --show-skipped),
// so users can always see what LogPilot did NOT look at. Nothing here writes to disk.

import path from "node:path";
import { nameWords } from "./names.js";
import type { SkipReason } from "./types.js";

/** A decision to skip a folder or file: the reason (for counting) and a short readable detail. */
export interface SkipDecision {
  reason: SkipReason;
  detail: string;
}

/**
 * Folders that are never scanned, even with --no-default-excludes: dependencies and git
 * internals. To scan a dependency anyway, scan its folder directly
 * (`logpilot scan node_modules/some-lib`).
 */
const ALWAYS_SKIPPED_FOLDERS = new Map([
  ["node_modules", "dependencies, never scanned"],
  [".git", "git internals, never scanned"],
]);

/** Folders skipped by default: third-party code and generated output. */
const DEFAULT_EXCLUDED_FOLDERS = new Map([
  ["bower_components", "third-party code"],
  ["jspm_packages", "third-party code"],
  ["vendor", "third-party code"],
  ["dist", "generated output"],
  ["build", "generated output"],
  ["coverage", "generated output"],
  [".next", "generated output"],
  [".nuxt", "generated output"],
  [".output", "generated output"],
  [".svelte-kit", "generated output"],
  // v0.4.1: tools' dot-named build and cache folders. Only names known to hold generated files: a
  // rule that skipped every dot folder would also skip project code (.github, .vitepress, .husky,
  // test fixtures in dot folders), as the check on all evaluated projects showed.
  [".angular", "generated output (Angular CLI cache)"],
  [".astro", "generated output (Astro)"],
  [".aws-sam", "generated output (AWS SAM build)"],
  [".cache", "generated output (a tool's cache)"],
  [".docusaurus", "generated output (Docusaurus)"],
  [".esbuild", "generated output (serverless-esbuild)"],
  [".expo", "generated output (Expo local state)"],
  [".firebase", "generated output (Firebase Hosting cache)"],
  [".netlify", "generated output (Netlify build)"],
  [".nx", "generated output (Nx cache)"],
  [".parcel-cache", "generated output (Parcel cache)"],
  [".serverless", "generated output (Serverless Framework package)"],
  [".turbo", "generated output (Turborepo cache)"],
  [".vercel", "generated output (Vercel build)"],
  [".vinxi", "generated output (Vinxi build)"],
  [".vite", "generated output (Vite cache)"],
  [".webpack", "generated output (webpack build)"],
  [".wrangler", "generated output (Cloudflare Wrangler)"],
  [".yarn", "third-party code (Yarn's own release and plugins)"],
]);

/**
 * The last word of a dot-named folder that marks it as build output: `.server-build`, `.build`,
 * `.dist`, `.remix-cache`. Only dot-named folders: a plain `output/` or `out/` folder can hold a
 * project's own code.
 */
const DOT_BUILD_LAST_WORDS = new Set(["build", "dist", "out", "output", "cache"]);

/** True for a dot-named folder whose last word is build, dist, out, output or cache. */
export function isDotBuildFolder(name: string): boolean {
  if (!name.startsWith(".")) return false;
  const words = nameWords(name.slice(1));
  return words.length > 0 && DOT_BUILD_LAST_WORDS.has(words[words.length - 1]);
}

/** `*.min.js`, `*.min.mjs`, `*.min.cjs`: minified by name. */
const MINIFIED_NAME = /\.min\.([cm]?js)$/i;

/**
 * Minified by content: GitHub Linguist treats a JavaScript file as minified when its average line
 * is longer than 110 characters. On its own that also caught a real source file full of long
 * strings (average 112), so LogPilot additionally requires one line longer than 1,000 characters:
 * minifiers write whole libraries onto a few enormous lines.
 */
const MINIFIED_AVERAGE_LINE = 110;
const MINIFIED_LONGEST_LINE = 1000;

/** A version number in a license banner: "v1.10.2", "v2.0", or a JSDoc-style "@version". */
const BANNER_VERSION = /\bv\d+\.\d+(\.\d+)?\b|@version\b/;

/**
 * What is wrong with a user's exclude pattern, or undefined if it can be used.
 * Patterns are glob patterns (`docs/**`, `**\/*.generated.js`) relative to the project folder.
 */
export function checkExcludePattern(pattern: string): string | undefined {
  if (pattern.trim() === "") return "a pattern cannot be empty";
  if (pattern.startsWith("!")) return 'patterns that start with "!" (exceptions) are not supported';
  if (pattern.includes("\\")) return 'use "/" in patterns, also on Windows';
  if (pattern.startsWith("/") || /^[A-Za-z]:/.test(pattern)) {
    return "patterns are relative to the project folder; remove the leading / or drive letter";
  }
  return undefined;
}

/**
 * The user's exclude patterns, matched with Node's built-in glob matching (path.posix.matchesGlob,
 * stable since Node 22.20 and 24.8). Paths are compared relative to `root` with "/" separators, so
 * results are the same on every OS. It remembers which patterns matched, to warn about unused ones.
 */
export class ExcludePatterns {
  private readonly used = new Set<string>();

  constructor(
    readonly patterns: readonly string[],
    readonly root: string,
  ) {}

  /** The first pattern that matches this file or folder (an absolute path), if any. */
  match(absolutePath: string, kind: "file" | "folder"): string | undefined {
    const relative = path.relative(this.root, absolutePath).split(path.sep).join("/");
    if (relative === "" || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
      return undefined; // outside the project folder: the patterns do not apply
    }
    for (const pattern of this.patterns) {
      // A folder pattern like "docs/**" also matches the folder "docs" itself, so it is not entered at all.
      const folderMatch =
        kind === "folder" && pattern.endsWith("/**") && path.posix.matchesGlob(relative, pattern.slice(0, -3));
      if (folderMatch || path.posix.matchesGlob(relative, pattern)) {
        this.used.add(pattern);
        return pattern;
      }
    }
    return undefined;
  }

  /** Patterns that never matched anything: probably a typo. */
  unused(): string[] {
    return this.patterns.filter((pattern) => !this.used.has(pattern));
  }
}

/**
 * Should the scan skip a folder with this name? undefined means: go inside.
 * With `defaultExcludes` off, only node_modules and .git are still skipped.
 */
export function folderSkip(name: string, defaultExcludes = true): SkipDecision | undefined {
  const always = ALWAYS_SKIPPED_FOLDERS.get(name);
  if (always !== undefined) return { reason: "default-folder", detail: always };
  if (!defaultExcludes) return undefined;
  const byDefault = DEFAULT_EXCLUDED_FOLDERS.get(name);
  if (byDefault !== undefined) return { reason: "default-folder", detail: byDefault };
  if (isDotBuildFolder(name)) return { reason: "default-folder", detail: "generated output (a dot-named build folder)" };
  return undefined;
}

/** A minified file, recognised by its name alone (checked before the file is even read). */
export function fileSkipByName(fileName: string): SkipDecision | undefined {
  const match = MINIFIED_NAME.exec(fileName);
  return match ? { reason: "minified-name", detail: `minified: the file name ends in .min.${match[1]}` } : undefined;
}

/**
 * A minified file or a copy of a third-party library, recognised by its text:
 * - vendored: the file starts with a `/*!` license comment that names a version
 *   (`/*! jQuery v1.10.2 ... *\/`). Projects often start their OWN files with `/*!` too
 *   (Express and Mongoose do), but without a version number, so those are still scanned.
 * - minified: see MINIFIED_AVERAGE_LINE and MINIFIED_LONGEST_LINE.
 */
export function fileSkipByContent(text: string): SkipDecision | undefined {
  const start = text.replace(/^﻿/, "").trimStart(); // ignore a byte-order mark and leading blank lines
  if (start.startsWith("/*!")) {
    const end = start.indexOf("*/");
    const banner = end === -1 ? start.slice(0, 2000) : start.slice(0, end);
    if (BANNER_VERSION.test(banner)) {
      return { reason: "vendored-banner", detail: "vendored: starts with a /*! license comment that names a version" };
    }
  }

  const lines = text.split(/\r?\n/);
  let totalLength = 0;
  let longest = 0;
  for (const line of lines) {
    totalLength += line.length;
    longest = Math.max(longest, line.length);
  }
  const average = Math.floor(totalLength / lines.length); // Linguist's formula: whole characters per line
  if (average > MINIFIED_AVERAGE_LINE && longest > MINIFIED_LONGEST_LINE) {
    return {
      reason: "minified-content",
      detail: `minified: lines average ${average} characters and the longest has ${longest}`,
    };
  }
  return undefined;
}
