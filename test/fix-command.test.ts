// Tests for src/fix-command.ts: `logpilot fix` end to end, in throw-away git repositories, with a
// fake terminal that plays the user (scripted answers, keys pressed during writes).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIX_EXIT, runFix, type FixRunOptions } from "../src/fix-command.js";
import type { Answer, FixIO } from "../src/prompt.js";
import { scanPath } from "../src/scanner.js";
import { git, withRepoAsync } from "./temp-repo.js";

/** An Express handler whose catch answers 500 without logging: LP003 with a console.error fix. */
function handler(route: string, errorName = "err"): string {
  return [
    `router.get("${route}", async (req, res) => {`,
    "  try {",
    "    res.json(await load(req.params.id));",
    `  } catch (${errorName}) {`,
    '    res.status(500).json({ message: "Server error" });',
    "  }",
    "});",
  ].join("\n");
}
const HEADER = 'const express = require("express");\nconst router = express.Router();\n';
/** src/app.js has 2 fixable findings, src/b.js has 1. */
const FILES = {
  "src/app.js": `${HEADER}${handler("/users/:id")}\n${handler("/orders/:id", "error")}\n`,
  "src/b.js": `${HEADER}${handler("/items/:id")}\n`,
};

/** A step of the fake user: an answer, or a function run first (e.g. to edit a file) that returns one. */
type Step = Answer | (() => Answer);

/** A fake terminal: answers from `steps`; `duringWrites[i]` describes keys pressed during write i. */
function fakeIO(steps: Step[], duringWrites: { interrupt?: boolean; typed?: boolean }[] = []) {
  const printed: string[] = [];
  let writes = 0;
  const io: FixIO = {
    print: (text) => printed.push(text),
    ask: async (question) => {
      printed.push(question);
      const step = steps.shift();
      if (step === undefined) throw new Error("the test ran out of answers");
      return typeof step === "function" ? step() : step;
    },
    writing: async (work) => {
      const result = work();
      const keys = duringWrites[writes++] ?? {};
      return { result, interrupted: keys.interrupt ?? false, typed: keys.typed ?? false };
    },
  };
  return { io, output: () => printed.join("\n"), unanswered: () => steps.length };
}

/** Runs `logpilot fix` on the repository (from its root), with the fake terminal. */
function fix(repo: string, io: FixIO, extra: Partial<FixRunOptions> = {}) {
  return runFix({ target: ".", cwd: repo, scanOptions: {}, io, toolVersion: "9.9.9", ...extra });
}
const read = (repo: string, file: string) => readFileSync(path.join(repo, ...file.split("/")), "utf8");
const changedFiles = (repo: string) => git(repo, "status", "--porcelain").trim();
const lp003Lines = (repo: string) => scanPath(".", repo).findings.filter((f) => f.ruleId === "LP003").map((f) => `${f.file}:${f.line}`);

describe("runFix: answering the questions", () => {
  it("writes the accepted fixes of a file at once, leaves declined ones, and says exactly what was written", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y", "n"]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.OK);
      expect(changedFiles(repo)).toBe("M src/app.js");
      expect(read(repo, "src/app.js")).toContain('console.error("Request failed:", { method: req.method, route: req.route?.path }, err);');
      expect(read(repo, "src/app.js")).toContain('console.error("Request failed:", { method: req.method, route: req.route?.path }, error);');
      expect(lp003Lines(repo)).toEqual(["src/b.js:6"]); // only the declined one is left
      expect(user.output()).toContain("LogPilot has 3 fixes for 2 files. Nothing is written until you answer y");
      expect(user.output()).toContain("Written: src/app.js (2 fixes). Checked after writing");
      expect(user.output()).toContain('Written: 2 fixes in 1 file: src/app.js (2 fixes). Nothing else was changed.\nTo see or undo LogPilot\'s changes:\n  git diff -- "src/app.js"\n  git checkout -- "src/app.js"');
      expect(user.output()).not.toContain("Nothing was written");
      expect(result.record?.summary).toEqual({ offered: 3, applied: 2, declined: 1, skipped: 0, notAsked: 0, notWritten: 0, failed: 0 });
    });
  });

  it("q at the first question: 'Nothing was written.', no file changed", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["q"]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.OK);
      expect(user.output().endsWith("Quit.\nNothing was written.")).toBe(true);
      expect(changedFiles(repo)).toBe("");
      expect(result.record?.stoppedBy).toBe("quit");
    });
  });

  it("q after one file was written: names that file and how to undo it (never 'Nothing was written')", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y", "q"]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.OK);
      expect(user.output()).toContain("Quit.\nWritten: 2 fixes in 1 file: src/app.js (2 fixes). Nothing else was changed.");
      expect(user.output()).toContain('  git checkout -- "src/app.js"');
      expect(user.output()).not.toContain("Nothing was written");
      expect(changedFiles(repo)).toBe("M src/app.js");
    });
  });

  it("q after accepting a fix in the current file: says that fix was not written", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "q"]);
      const result = await fix(repo, user.io);

      expect(user.output().endsWith("Quit.\nThe 1 fix you accepted in src/app.js was not written.\nNothing was written.")).toBe(true);
      expect(changedFiles(repo)).toBe("");
      expect(result.record?.fixes.map((f) => f.status)).toEqual(["not-written", "not-asked", "not-asked"]);
    });
  });

  it("Ctrl+C at the first question: exit 130, 'Nothing was written.'", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["interrupt"]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.INTERRUPTED);
      expect(user.output().endsWith("Stopped (Ctrl+C).\nNothing was written.")).toBe(true);
      expect(changedFiles(repo)).toBe("");
    });
  });

  it("Ctrl+C at a question after writes: exit 130, and names every file written so far", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y", "interrupt"]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.INTERRUPTED);
      expect(user.output()).toContain("Stopped (Ctrl+C).\nWritten: 2 fixes in 1 file: src/app.js (2 fixes). Nothing else was changed.");
      expect(user.output()).not.toContain("Nothing was written");
      expect(changedFiles(repo)).toBe("M src/app.js");
    });
  });

  it("Ctrl+C during a write: the file is written completely, then the run stops (exit 130) and says so", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y"], [{ interrupt: true }]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.INTERRUPTED);
      expect(user.output()).toContain("Stopped (Ctrl+C), after src/app.js was written completely.\nWritten: 2 fixes in 1 file: src/app.js (2 fixes).");
      expect(lp003Lines(repo)).toEqual(["src/b.js:6"]); // both fixes of app.js are there, b.js was not asked
      expect(user.unanswered()).toBe(0);
      expect(result.record?.fixes.map((f) => f.status)).toEqual(["applied", "applied", "not-asked"]);
    });
  });

  it("says that keys pressed during a write were ignored, and still asks the next question", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y", "n"], [{ typed: true }]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.OK);
      expect(user.output()).toContain("(Keys you pressed while LogPilot was writing were ignored: they are not answers to any question.)");
      expect(user.unanswered()).toBe(0); // the question for b.js was asked and answered with n
    });
  });

  it("s skips the rest of the file", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["s", "y"]);
      const result = await fix(repo, user.io);

      expect(changedFiles(repo)).toBe("M src/b.js");
      expect(result.record?.fixes.map((f) => f.status)).toEqual(["skipped-file", "skipped-file", "applied"]);
    });
  });
});

describe("runFix: files that may not be changed, and problems", () => {
  it("refuses outside a git repository, before scanning, with exit 2", async () => {
    const result = await runFix({ target: ".", cwd: path.parse(process.cwd()).root, scanOptions: {}, io: fakeIO([]).io, toolVersion: "9.9.9" });
    expect([result.exitCode, result.error?.endsWith(". Nothing was changed.")]).toEqual([FIX_EXIT.STOPPED, true]);
  });

  it("does not ask about a file with uncommitted changes, and says why", async () => {
    await withRepoAsync(FILES, async (repo) => {
      writeFileSync(path.join(repo, "src", "b.js"), `${read(repo, "src/b.js")}// edited\n`);
      const user = fakeIO(["n", "n"]);
      const result = await fix(repo, user.io);

      expect(user.output()).toContain('Not asked: 1 fix in src/b.js, because it has changes that are not committed (git status: "M"): commit or stash them first.');
      expect(user.output()).toContain("LogPilot has 2 fixes for 1 file.");
      expect(result.record?.summary.notAsked).toBe(1);
    });
  });

  it("does not write a file that changed after it was scanned, and keeps that change (exit 1)", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const edit = () => {
        writeFileSync(path.join(repo, "src", "app.js"), `${read(repo, "src/app.js")}// the user edited this meanwhile\n`);
        return "y" as const;
      };
      const user = fakeIO(["y", edit, "n"]);
      const result = await fix(repo, user.io);

      expect(result.exitCode).toBe(FIX_EXIT.NOT_ALL_WRITTEN);
      expect(user.output()).toContain("Not written: src/app.js, because it changed since LogPilot read it");
      expect(read(repo, "src/app.js").endsWith("// the user edited this meanwhile\n")).toBe(true);
      expect(read(repo, "src/app.js")).not.toContain("console.error");
      expect(user.output()).toContain("Nothing was written.");
    });
  });

  it("another program changes the file during the write: nothing is written back, STOPPED with exit 2 and the git commands", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y"]);
      const result = await fix(repo, user.io, { testHooks: { replace: { afterRename: (f) => writeFileSync(f, "changed by another program\n") } } });

      expect(result.exitCode).toBe(FIX_EXIT.STOPPED);
      expect(read(repo, "src/app.js")).toBe("changed by another program\n"); // kept: LogPilot did not overwrite it
      expect(user.output()).toContain("STOPPED: after LogPilot wrote src/app.js, the file on disk does not have the bytes LogPilot wrote");
      expect(user.output()).toContain("LogPilot did NOT write anything back");
      expect(user.output()).toContain('  git diff -- "src/app.js"');
      expect(user.output()).toContain('  git checkout -- "src/app.js"');
      expect(user.output().endsWith("Nothing was written.")).toBe(true); // src/app.js does not count as written
      expect(user.unanswered()).toBe(0); // b.js was never asked
      expect(result.record?.files[0]).toMatchObject({ file: "src/app.js", status: "changed-after-write" });
    });
  });

  it("LogPilot's own written bytes fail the post-write check: the original is written back (exit 1)", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y", "n"]);
      const result = await fix(repo, user.io, { testHooks: { postWriteCheck: () => "LP003 still reports this code after the fix" } });

      expect(result.exitCode).toBe(FIX_EXIT.NOT_ALL_WRITTEN);
      expect(changedFiles(repo)).toBe("");
      expect(user.output()).toContain("Not kept: src/app.js failed LogPilot's check after writing (LP003 still reports this code after the fix)");
      expect(user.output()).toContain("Nothing was written.");
    });
  });
});

describe("runFix: what it writes, and undo", () => {
  it("keeps a BOM and CRLF line endings, and changes nothing but the inserted lines", async () => {
    const crlf = `﻿${FILES["src/b.js"].replace(/\n/g, "\r\n")}`;
    await withRepoAsync({ "src/b.js": crlf }, async (repo) => {
      await fix(repo, fakeIO(["y"]).io);
      const after = read(repo, "src/b.js");

      expect(after.startsWith("﻿")).toBe(true);
      expect(after.replace(/\r\n/g, "")).not.toContain("\n"); // every line ends with CRLF
      const removed = after.split("\r\n").filter((line) => !line.includes("console.error")).join("\r\n");
      expect(removed).toBe(crlf); // the original, plus inserted lines only
    });
  });

  it("the printed undo command really restores the file", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["y", "y", "n"]);
      await fix(repo, user.io);
      const checkout = /git checkout -- "(.+?)"/.exec(user.output())?.[1] ?? "";

      expect(checkout).toBe("src/app.js");
      git(repo, "checkout", "--", checkout);
      expect(changedFiles(repo)).toBe("");
    });
  });

  it("gives git -C commands when LogPilot is run from outside the repository", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const user = fakeIO(["n", "n", "y"]);
      await runFix({ target: path.join(repo, "src"), cwd: path.join(repo, ".."), scanOptions: {}, io: user.io, toolVersion: "9.9.9" });

      expect(user.output()).toMatch(/ {2}git -C ".+my repo" checkout -- "src\/b\.js"/);
    });
  });

  it("writes a JSON-ready record of the run", async () => {
    await withRepoAsync(FILES, async (repo) => {
      const result = await fix(repo, fakeIO(["y", "n", "n"]).io);
      const record = result.record;

      expect(record).toMatchObject({ schema: "logpilot-fix-run", schemaVersion: 1, tool: { name: "logpilot", version: "9.9.9" }, scannedPath: ".", exitCode: 0, stoppedBy: null });
      expect(record?.gitHead).toBe(git(repo, "rev-parse", "HEAD").trim());
      expect(record?.files.map((f) => [f.file, f.status])).toEqual([["src/app.js", "written"], ["src/b.js", "nothing-accepted"]]);
      expect(record?.files[0].sha256Before).toMatch(/^[0-9a-f]{64}$/);
      expect(record?.files[0].sha256After).not.toBe(record?.files[0].sha256Before);
      expect(record?.fixes.map((f) => f.status)).toEqual(["applied", "declined", "declined"]);
      expect(JSON.parse(JSON.stringify(record))).toEqual(record);
    });
  });
});

