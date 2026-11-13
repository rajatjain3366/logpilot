// Tests for src/fix-preconditions.ts: which files `logpilot fix` may change, and the reason given
// for each one it may not. Every test works in a throw-away git repository (test/temp-repo.ts).

import { execFileSync } from "node:child_process";
import { chmodSync, linkSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFile, openRepository, type Repository } from "../src/fix-preconditions.js";
import { git, shortPath, withFolder, withRepo } from "./temp-repo.js";

/** Opens the repository (it must be one) and checks `relative` (with "/") inside it. */
function check(repo: string, relative: string, scanRoot = repo) {
  const opened = openRepository(scanRoot);
  if (!opened.ok) throw new Error(opened.reason);
  return checkFile(path.join(repo, ...relative.split("/")), scanRoot, opened.repository);
}
/** The reason a file is refused, or "ok". */
function verdict(repo: string, relative: string, scanRoot?: string): string {
  const result = check(repo, relative, scanRoot);
  return result.ok ? "ok" : result.reason;
}

describe("openRepository", () => {
  it("refuses a folder that is not in a git repository, and says why", () => {
    withFolder((dir) => {
      const opened = openRepository(dir);
      expect(opened.ok).toBe(false);
      expect(!opened.ok && opened.reason).toBe(
        "this folder is not in a git repository. logpilot fix only changes files that git can restore, so every " +
          "change can be undone (git init, then commit your files, and run it again)",
      );
    });
  });

  it("refuses when git is not installed", () => {
    withFolder((dir) => {
      const opened = openRepository(dir, "git-not-installed-logpilot-test");
      expect(!opened.ok && opened.reason).toBe("git is not installed, or not on your PATH");
    });
  });

  it("finds the repository from a scanned subfolder", () => {
    withRepo({ "src/app.js": "a\n" }, (repo) => {
      const opened = openRepository(path.join(repo, "src"));
      // CHANGED ON PURPOSE (CI on windows-latest): the root is the REAL path of the repository folder.
      expect(opened.ok && (opened.repository as Repository).root).toBe(realpathSync.native(repo));
    });
  });
});

describe("checkFile: files that may be changed", () => {
  it("accepts a clean tracked file, with its exact bytes and text and its path in the repository", () => {
    const code = "﻿const café = 1;\r\n"; // BOM, non-ASCII, CRLF
    withRepo({ "src/my routes/[id].js": code }, (repo) => {
      const result = check(repo, "src/my routes/[id].js");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.target.repositoryPath).toBe("src/my routes/[id].js");
      expect(result.target.text).toBe(code); // the BOM stays, so offsets match the scan's text
      expect(result.target.bytes.equals(Buffer.from(code, "utf8"))).toBe(true);
      expect(result.target.absolutePath).toBe(path.join(repo, "src", "my routes", "[id].js"));
    });
  });

  it("accepts LF, CRLF and mixed line endings when git converts nothing (core.autocrlf=false)", () => {
    withRepo({ "lf.js": "a;\nb;\n", "crlf.js": "a;\r\nb;\r\n", "mixed.js": "a;\r\nb;\n" }, (repo) => {
      expect(["lf.js", "crlf.js", "mixed.js"].map((f) => verdict(repo, f))).toEqual(["ok", "ok", "ok"]);
    });
  });

  // CI found this: GitHub's Windows runners give the temp folder as C:\Users\RUNNER~1\... (8.3 short
  // names), while git reports C:/Users/runneradmin/... for the same folder. Every file was then
  // "outside the git repository".
  it.runIf(process.platform === "win32")("accepts files when the scanned folder is spelled with 8.3 short names (Windows)", () => {
    withRepo({ "src/my routes/app.js": "a\n" }, (repo) => {
      const short = shortPath(repo);
      // Precondition: the two spellings really differ here (8.3 names exist), or this test proves nothing.
      expect(short.toLowerCase(), "precondition: 8.3 short names exist for the temp folder").not.toBe(repo.toLowerCase());

      const opened = openRepository(short);
      if (!opened.ok) throw new Error(opened.reason);
      const result = checkFile(path.join(short, "src", "my routes", "app.js"), short, opened.repository);
      expect(result.ok ? "ok" : result.reason).toBe("ok");
      expect(result.ok && result.target.repositoryPath).toBe("src/my routes/app.js");
    });
  });

  // The scanned folder itself may be a junction to the repository (only links BELOW it are refused).
  it.runIf(process.platform === "win32")("accepts files when the repository is scanned through a junction to it (Windows)", () => {
    withRepo({ "src/app.js": "a\n" }, (repo) => {
      const junction = path.join(repo, "..", "repo through a junction");
      execFileSync("cmd.exe", ["/c", "mklink", "/J", junction, repo], { stdio: "ignore" });

      const opened = openRepository(junction);
      if (!opened.ok) throw new Error(opened.reason);
      const result = checkFile(path.join(junction, "src", "app.js"), junction, opened.repository);
      expect(result.ok ? "ok" : result.reason).toBe("ok");
      expect(result.ok && result.target.repositoryPath).toBe("src/app.js");
    });
  });

  it("accepts a file whose scanned folder is a subfolder of the repository", () => {
    withRepo({ "backend/src/app.js": "a\n" }, (repo) => {
      expect(verdict(repo, "backend/src/app.js", path.join(repo, "backend"))).toBe("ok");
    });
  });
});

describe("checkFile: files that are refused, with the reason", () => {
  it("refuses files with changes, staged or not, and says to commit or stash them", () => {
    withRepo({ "unstaged.js": "a\n", "staged.js": "b\n" }, (repo) => {
      writeFileSync(path.join(repo, "unstaged.js"), "a2\n");
      writeFileSync(path.join(repo, "staged.js"), "b2\n");
      git(repo, "add", "staged.js");

      expect(verdict(repo, "unstaged.js")).toBe('it has changes that are not committed (git status: "M"): commit or stash them first');
      expect(verdict(repo, "staged.js")).toBe('it has changes that are not committed (git status: "M"): commit or stash them first');
    });
  });

  it("refuses untracked and ignored files", () => {
    withRepo({ ".gitignore": "ignored.js\n" }, (repo) => {
      writeFileSync(path.join(repo, "new.js"), "n\n");
      writeFileSync(path.join(repo, "ignored.js"), "i\n");
      const reason = "git does not track it (a new or ignored file, or a file of another repository such as a submodule): commit it first";

      expect(verdict(repo, "new.js")).toBe(reason);
      expect(verdict(repo, "ignored.js")).toBe(reason);
    });
  });

  it("refuses a file of a nested repository", () => {
    withRepo({ "a.js": "a\n" }, (repo) => {
      const inner = path.join(repo, "vendor", "inner");
      mkdirSync(inner, { recursive: true });
      git(inner, "init", "-q");
      writeFileSync(path.join(inner, "lib.js"), "l\n");
      git(inner, "add", "lib.js");
      git(inner, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "inner");

      expect(verdict(repo, "vendor/inner/lib.js")).toMatch(/^git does not track it/);
    });
  });

  it("refuses a file outside the scanned folder", () => {
    withRepo({ "backend/app.js": "a\n", "shared/util.js": "u\n" }, (repo) => {
      expect(verdict(repo, "shared/util.js", path.join(repo, "backend"))).toBe("it is outside the scanned folder");
    });
  });

  it("refuses a file reached through a symbolic link, when this system lets us create one", () => {
    withRepo({ "real/app.js": "a\n" }, (repo) => {
      try {
        symlinkSync(path.join(repo, "real", "app.js"), path.join(repo, "link.js"));
      } catch (error) {
        // Windows allows symbolic links only in developer mode or as administrator (the junction
        // test covers Windows). Linux and macOS always allow them: there, failing to create one fails
        // the test, so a green run on Linux CI proves that the refusal was really checked.
        if (process.platform !== "win32") throw error;
        return;
      }
      expect(verdict(repo, "link.js")).toBe("it is reached through a symbolic link or junction");
    });
  });

  it.runIf(process.platform === "win32")("refuses a file reached through a junction (Windows)", () => {
    withRepo({ "real/app.js": "a\n" }, (repo) => {
      execFileSync("cmd.exe", ["/c", "mklink", "/J", path.join(repo, "junction"), path.join(repo, "real")], { stdio: "ignore" });
      expect(verdict(repo, "junction/app.js")).toBe("it is reached through a symbolic link or junction");
    });
  });

  it("refuses a file with a second name (a hard link)", () => {
    withRepo({ "app.js": "a\n" }, (repo) => {
      linkSync(path.join(repo, "app.js"), path.join(repo, "..", "second-name.js"));
      expect(verdict(repo, "app.js")).toBe("it has more than one name (a hard link); replacing it would separate the names");
    });
  });

  it("refuses a read-only file", () => {
    withRepo({ "app.js": "a\n" }, (repo) => {
      chmodSync(path.join(repo, "app.js"), 0o444);
      try {
        expect(verdict(repo, "app.js")).toBe("it is read-only (LogPilot never changes file permissions)");
      } finally {
        chmodSync(path.join(repo, "app.js"), 0o644); // so the temp folder can be deleted on Windows
      }
    });
  });

  it("refuses files that are not valid UTF-8 (Latin-1, UTF-16)", () => {
    const latin1 = Buffer.from([0x2f, 0x2f, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a]); // "// café" in Latin-1
    const utf16 = Buffer.from("﻿const a = 1;\n", "utf16le");
    withRepo({ "latin1.js": latin1, "utf16.js": utf16 }, (repo) => {
      const reason = "it is not valid UTF-8 (for example Latin-1 or UTF-16), so rewriting it could damage it";
      expect(verdict(repo, "latin1.js")).toBe(reason);
      expect(verdict(repo, "utf16.js")).toBe(reason);
    });
  });

  // Milestone 4 spike: git calls these files "clean", but `git checkout` would give them back with CRLF.
  it("refuses LF and mixed files when git would not give them back byte for byte (core.autocrlf=true)", () => {
    withRepo(
      { "lf.js": "a;\nb;\n", "crlf.js": "a;\r\nb;\r\n", "mixed.js": "a;\r\nb;\n" },
      (repo) => {
        const reason =
          "git would not give back this file byte for byte (its line endings, or another git setting such as " +
          "core.autocrlf or .gitattributes, differ from what git writes on checkout), so an undo with git would not be exact";
        expect(verdict(repo, "crlf.js")).toBe("ok");
        expect(verdict(repo, "lf.js")).toBe(reason);
        expect(verdict(repo, "mixed.js")).toBe(reason);
      },
      { autocrlf: "true" },
    );
  });

  it("refuses a file with an unresolved merge conflict", () => {
    withRepo({ "same.js": "base\n" }, (repo) => {
      git(repo, "checkout", "-q", "-b", "other");
      writeFileSync(path.join(repo, "same.js"), "other\n");
      git(repo, "commit", "-q", "-am", "other");
      git(repo, "checkout", "-q", "-");
      writeFileSync(path.join(repo, "same.js"), "main\n");
      git(repo, "commit", "-q", "-am", "main");
      expect(() => git(repo, "merge", "-q", "other")).toThrow();

      expect(verdict(repo, "same.js")).toBe("it has an unresolved merge conflict");
    });
  });
});
