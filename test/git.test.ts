// Tests for src/git.ts: finding the repository, tracked and changed files, and the exact bytes
// `git checkout` would give back. Every test works in a throw-away repository (test/temp-repo.ts).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles, checkoutBytes, findProgram, GitError, indexEntries, repositoryRoot } from "../src/git.js";
import { git, withFolder, withRepo } from "./temp-repo.js";

describe("repositoryRoot", () => {
  it("finds the repository root from a subfolder, also with spaces in the path", () => {
    withRepo({ "src/my routes/a.js": "a\n" }, (repo) => {
      expect(repositoryRoot(path.join(repo, "src", "my routes"))).toBe(repo);
    });
  });

  it("returns undefined outside any repository", () => {
    withFolder((dir) => {
      expect(repositoryRoot(dir)).toBeUndefined();
    });
  });

  it("says clearly when git is not installed", () => {
    withFolder((dir) => {
      expect(() => repositoryRoot(dir, "git-not-installed-logpilot-test")).toThrow(GitError);
      expect(() => repositoryRoot(dir, "git-not-installed-logpilot-test")).toThrow("git is not installed, or not on your PATH");
    });
  });

  // On Windows, a program named only "git" is looked for in the current folder FIRST, unless the
  // NoDefaultCurrentDirectoryInExePath variable is set (an early user's Git Bash does not set it; the
  // environment of Milestone 4's spike did, which hid this). LogPilot runs git by its full path.
  it.runIf(process.platform === "win32")("never runs a git.exe placed in the current folder (Windows)", () => {
    withRepo({ "a.js": "a\n" }, (repo) => {
      const planted = path.join(repo, "..", "planted");
      mkdirSync(planted);
      // A harmless program that prints no git version: hostname.exe exits with 1 for these arguments.
      copyFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "hostname.exe"), path.join(planted, "git.exe"));
      const before = process.cwd();
      const saved = process.env.NoDefaultCurrentDirectoryInExePath;
      delete process.env.NoDefaultCurrentDirectoryInExePath; // the default on a normal Windows machine
      process.chdir(planted);
      try {
        // Precondition: here, running plain "git" really would run the planted file (the danger is real).
        const plain = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
        expect(plain.stdout.startsWith("git version"), "precondition: plain 'git' should find the planted git.exe").toBe(false);

        expect(repositoryRoot(repo)).toBe(repo); // LogPilot still runs the real git
      } finally {
        process.chdir(before);
        if (saved !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = saved;
      }
    });
  });

  // On every OS: a relative PATH entry ("." or "") would also mean the current folder.
  it("never runs a 'git' found through a relative PATH entry such as '.'", () => {
    withRepo({ "a.js": "a\n" }, (repo) => {
      const planted = path.join(repo, "..", "planted");
      mkdirSync(planted);
      const fake = process.platform === "win32" ? "git.exe" : "git";
      if (process.platform === "win32") {
        copyFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "hostname.exe"), path.join(planted, fake));
      } else {
        writeFileSync(path.join(planted, fake), "#!/bin/sh\necho planted\nexit 1\n", { mode: 0o755 });
      }
      const before = { cwd: process.cwd(), PATH: process.env.PATH };
      process.env.PATH = [".", "", before.PATH ?? ""].join(path.delimiter);
      process.chdir(planted);
      try {
        expect(findProgram("git")).not.toBe(path.join(planted, fake));
        expect(repositoryRoot(repo)).toBe(repo);
      } finally {
        process.chdir(before.cwd);
        process.env.PATH = before.PATH;
      }
    });
  });

  it("puts git's whole error output, the program and the exit code into the error", () => {
    withRepo({ "a.js": "a\n" }, (repo) => {
      const missingBlob = "0123456789abcdef0123456789abcdef01234567";
      // What git itself says for the same command (its wording and exit code differ between versions).
      const gitPath = findProgram("git") ?? "";
      const args = ["-c", "core.fsmonitor=false", "--no-optional-locks", "-C", repo, "cat-file", "--filters", "--path=a.js", missingBlob];
      const direct = spawnSync(gitPath, args, { encoding: "utf8", windowsHide: true });
      expect(direct.stderr.trim()).not.toBe(""); // git really reports something here

      expect(() => checkoutBytes(repo, "a.js", missingBlob)).toThrow(GitError);
      expect(() => checkoutBytes(repo, "a.js", missingBlob)).toThrow(
        `git cat-file failed: ${direct.stderr.trim()} (${gitPath}, exit code ${direct.status})`,
      );
    });
  });
});

describe("findProgram", () => {
  it("finds git by its full path in an absolute PATH folder", () => {
    const git = findProgram("git");
    expect(git).toBeDefined();
    expect(path.isAbsolute(git ?? "")).toBe(true);
  });

  it("skips empty, relative and quoted-but-missing entries, and returns undefined when nothing matches", () => {
    withFolder((dir) => {
      const name = process.platform === "win32" ? "tool.exe" : "tool";
      writeFileSync(path.join(dir, name), "");
      const sep = path.delimiter;
      expect(findProgram("tool", ["", ".", "relative/folder", `"${dir}"`].join(sep))).toBe(path.join(dir, name)); // quotes removed
      expect(findProgram("tool", ["", ".", "relative/folder"].join(sep))).toBeUndefined();
      expect(findProgram("missing-tool", dir)).toBeUndefined();
    });
  });
});

describe("indexEntries", () => {
  it("lists every tracked file with its mode and blob, with '/' paths, spaces and brackets as they are", () => {
    withRepo({ "a.js": "a\n", "src/my routes/[id].js": "b\n" }, (repo) => {
      const entries = indexEntries(repo);

      expect([...entries.keys()].sort()).toEqual(["a.js", "src/my routes/[id].js"]);
      expect(entries.get("a.js")).toEqual({ mode: "100644", blob: git(repo, "hash-object", "a.js").trim() });
    });
  });

  it("reports an executable file, a symbolic link and a merge conflict by their mode", () => {
    withRepo({ "run.js": "x\n", "same.js": "base\n" }, (repo) => {
      git(repo, "update-index", "--chmod=+x", "run.js");
      const blob = git(repo, "hash-object", "-w", "run.js").trim();
      git(repo, "update-index", "--add", "--cacheinfo", `120000,${blob},link.js`);
      git(repo, "commit", "-q", "-m", "modes");
      // A merge conflict on same.js.
      // (Only same.js is staged: link.js exists only in the index, and `commit -a` would delete it.)
      git(repo, "checkout", "-q", "-b", "other");
      writeFileSync(path.join(repo, "same.js"), "other\n");
      git(repo, "add", "same.js");
      git(repo, "commit", "-q", "-m", "other");
      git(repo, "checkout", "-q", "-");
      writeFileSync(path.join(repo, "same.js"), "main\n");
      git(repo, "add", "same.js");
      git(repo, "commit", "-q", "-m", "main");
      expect(() => git(repo, "merge", "-q", "other")).toThrow(); // the conflict

      const entries = indexEntries(repo);
      expect(entries.get("run.js")?.mode).toBe("100755");
      expect(entries.get("link.js")?.mode).toBe("120000");
      expect(entries.get("same.js")?.mode).toBe("conflict");
    });
  });
});

describe("changedFiles", () => {
  it("lists tracked files with staged or unstaged changes, including both paths of a rename", () => {
    const files = { "clean.js": "c\n", "unstaged.js": "u\n", "staged.js": "s\n", "both.js": "b\n", "old name.js": "r\n", "deleted.js": "d\n" };
    withRepo(files, (repo) => {
      writeFileSync(path.join(repo, "unstaged.js"), "u2\n");
      writeFileSync(path.join(repo, "staged.js"), "s2\n");
      git(repo, "add", "staged.js");
      writeFileSync(path.join(repo, "both.js"), "b2\n");
      git(repo, "add", "both.js");
      writeFileSync(path.join(repo, "both.js"), "b3\n");
      git(repo, "mv", "old name.js", "new name.js");
      git(repo, "rm", "-q", "deleted.js");
      writeFileSync(path.join(repo, "untracked.js"), "x\n");

      expect(Object.fromEntries(changedFiles(repo))).toEqual({
        "unstaged.js": " M",
        "staged.js": "M ",
        "both.js": "MM",
        "new name.js": "R ",
        "old name.js": "R ",
        "deleted.js": "D ",
      });
    });
  });

  it("is empty for a repository without changes", () => {
    withRepo({ "a.js": "a\n" }, (repo) => {
      expect(changedFiles(repo).size).toBe(0);
    });
  });
});

describe("checkoutBytes", () => {
  const files = { "crlf.js": "a();\r\nb();\r\n", "lf.js": "a();\nb();\n", "mixed.js": "a();\r\nb();\n", "bom.js": "\ufeffa();\n" };

  it("gives exactly the file's bytes when git converts nothing (core.autocrlf=false)", () => {
    withRepo(files, (repo) => {
      const entries = indexEntries(repo);
      for (const name of Object.keys(files)) {
        expect([name, checkoutBytes(repo, name, entries.get(name)?.blob ?? "").equals(readFileSync(path.join(repo, name)))]).toEqual([name, true]);
      }
    });
  });

  // The spike's finding: with core.autocrlf=true, LF and mixed files are "clean" but come back as CRLF.
  it("gives CRLF line endings with core.autocrlf=true, so only the CRLF file comes back unchanged", () => {
    withRepo(
      files,
      (repo) => {
        const entries = indexEntries(repo);
        const same = (name: string) => checkoutBytes(repo, name, entries.get(name)?.blob ?? "").equals(readFileSync(path.join(repo, name)));

        expect(changedFiles(repo).size).toBe(0); // git calls them all clean
        expect([same("crlf.js"), same("lf.js"), same("mixed.js")]).toEqual([true, false, false]);
        expect(checkoutBytes(repo, "lf.js", entries.get("lf.js")?.blob ?? "").toString()).toBe("a();\r\nb();\r\n");
      },
      { autocrlf: "true" },
    );
  });
});
