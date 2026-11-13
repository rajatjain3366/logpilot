// Tests for src/fix-write.ts: replacing a file atomically, refusing when it changed, retrying a
// lock, restoring the original when the written file fails its check, and listing leftovers.

import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { leftoverTempFiles, replaceFile } from "../src/fix-write.js";
import { withFolder } from "./temp-repo.js";

/** A file with a BOM, CRLF line endings and non-ASCII text: every byte must survive. */
const ORIGINAL = Buffer.from("﻿const café = 1;\r\ntry { run(); } catch (err) {\r\n}\r\n", "utf8");
const REPLACEMENT = Buffer.from("﻿const café = 1;\r\ntry { run(); } catch (err) {\r\n  console.error(err);\r\n}\r\n", "utf8");

/** Runs `body` with a folder holding app.js (ORIGINAL) and an unrelated other.js. */
function withFile(body: (file: string, dir: string) => void): void {
  withFolder((dir) => {
    writeFileSync(path.join(dir, "app.js"), ORIGINAL);
    writeFileSync(path.join(dir, "other.js"), "untouched\n");
    body(path.join(dir, "app.js"), dir);
  });
}

/** An error such as the operating system gives, with a `code`. */
function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated`), { code });
}

describe("replaceFile: writing", () => {
  it("writes exactly the new bytes (BOM, CRLF, non-ASCII), leaves no temporary file and touches no other file", () => {
    withFile((file, dir) => {
      expect(replaceFile(file, ORIGINAL, REPLACEMENT)).toEqual({ status: "written" });

      expect(readFileSync(file).equals(REPLACEMENT)).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
      expect(readFileSync(path.join(dir, "other.js"), "utf8")).toBe("untouched\n");
    });
  });

  it.skipIf(process.platform === "win32")("keeps the file's permissions (Linux and macOS)", () => {
    withFile((file) => {
      chmodSync(file, 0o750);
      expect(replaceFile(file, ORIGINAL, REPLACEMENT).status).toBe("written");
      expect(statSync(file).mode & 0o777).toBe(0o750);
    });
  });

  it("writes nothing when the file changed since it was read, and keeps the other program's change", () => {
    withFile((file, dir) => {
      writeFileSync(file, "edited by the user meanwhile\n");
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT);

      expect(outcome).toEqual({
        status: "not-written",
        reason: "it changed since LogPilot read it (run logpilot fix again to see fixes for the new version)",
      });
      expect(readFileSync(file, "utf8")).toBe("edited by the user meanwhile\n");
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
    });
  });

  it("writes nothing when the file is gone", () => {
    withFolder((dir) => {
      const outcome = replaceFile(path.join(dir, "gone.js"), ORIGINAL, REPLACEMENT);
      expect(outcome).toEqual({ status: "not-written", reason: "it could not be read again (ENOENT)" });
      expect(readdirSync(dir)).toEqual([]);
    });
  });
});

describe("replaceFile: a file locked by another program", () => {
  it("retries a rename that a lock blocks, and succeeds once the lock is gone", () => {
    withFile((file) => {
      let attempts = 0;
      const rename = (from: string, to: string) => {
        attempts++;
        if (attempts <= 2) throw failure("EBUSY");
        renameSync(from, to);
      };
      expect(replaceFile(file, ORIGINAL, REPLACEMENT, { retryEveryMs: 10, hooks: { rename } })).toEqual({ status: "written" });
      expect(attempts).toBe(3);
      expect(readFileSync(file).equals(REPLACEMENT)).toBe(true);
    });
  });

  it("gives up after the retry time, keeps the original and removes the temporary file", () => {
    withFile((file, dir) => {
      let attempts = 0;
      const started = Date.now();
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, {
        retryForMs: 300,
        retryEveryMs: 50,
        hooks: {
          rename: () => {
            attempts++;
            throw failure("EPERM");
          },
        },
      });

      expect(outcome).toEqual({
        status: "not-written",
        reason: "it is locked by another program (close the program that has it open, then run logpilot fix again)",
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(attempts).toBeGreaterThan(3);
      expect(readFileSync(file).equals(ORIGINAL)).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
    });
  });

  it("does not retry other errors", () => {
    withFile((file, dir) => {
      let attempts = 0;
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, {
        hooks: {
          rename: () => {
            attempts++;
            throw failure("EXDEV");
          },
        },
      });

      expect(outcome).toEqual({ status: "not-written", reason: "it could not be replaced (EXDEV)" });
      expect(attempts).toBe(1);
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
    });
  });

  /**
   * Opens `file` in a PowerShell process without sharing, for `ms` milliseconds. Resolves once it is
   * open, with `{ exited }` (a promise for the end of the lock). The object wrapper matters: resolving
   * with the promise itself would make `await` wait until the lock is already gone.
   */
  function lockWithPowerShell(file: string, ms: number): Promise<{ exited: Promise<unknown> }> {
    const script = `$f = [System.IO.File]::Open('${file}', 'Open', 'Read', 'None'); Write-Output ready; Start-Sleep -Milliseconds ${ms}; $f.Close()`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { stdio: ["ignore", "pipe", "inherit"] });
    const exited = new Promise((resolve) => child.on("exit", resolve));
    return new Promise((resolve) => child.stdout.on("data", (data) => String(data).includes("ready") && resolve({ exited })));
  }

  // The spike showed that on Windows any open handle blocks the rename (EPERM).
  /** Like withFile, but waits for an async body before deleting the folder. */
  async function withFileAsync(body: (file: string, dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-fix-test-"));
    try {
      writeFileSync(path.join(dir, "app.js"), ORIGINAL);
      writeFileSync(path.join(dir, "other.js"), "untouched\n");
      await body(path.join(dir, "app.js"), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.runIf(process.platform === "win32")("Windows: a real lock that outlasts the retries -> not written, original kept", { timeout: 20_000 }, async () => {
    await withFileAsync(async (file, dir) => {
      const { exited } = await lockWithPowerShell(file, 3500);
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT); // default: 2 s of retries
      await exited;
      expect(outcome).toEqual({
        status: "not-written",
        reason: "it is locked by another program (close the program that has it open, then run logpilot fix again)",
      });
      expect(readFileSync(file).equals(ORIGINAL)).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
    });
  });

  it.runIf(process.platform === "win32")("Windows: a real lock released after 0.6 s -> written by a retry", { timeout: 20_000 }, async () => {
    await withFileAsync(async (file) => {
      const { exited } = await lockWithPowerShell(file, 600);
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT);
      await exited;
      expect(outcome).toEqual({ status: "written" });
      expect(readFileSync(file).equals(REPLACEMENT)).toBe(true);
    });
  });
});

describe("replaceFile: checking the written file, and restoring the original", () => {
  it("passes the bytes read back to the check, and keeps them when the check passes", () => {
    withFile((file) => {
      let checked: Buffer | undefined;
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, { check: (written) => ((checked = written), undefined) });

      expect(outcome).toEqual({ status: "written" });
      expect(checked?.equals(REPLACEMENT)).toBe(true);
    });
  });

  it("writes the original back when the check fails", () => {
    withFile((file, dir) => {
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, { check: () => "LP003 still reports this code" });

      expect(outcome).toEqual({ status: "restored", reason: "LP003 still reports this code" });
      expect(readFileSync(file).equals(ORIGINAL)).toBe(true);
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
    });
  });

  // CHANGED ON PURPOSE (Milestone 4, Checkpoint 3): this used to write the original back. When the
  // file on disk is not what LogPilot wrote, another program may have changed it: writing the
  // original back would destroy that change. Now nothing is written back; a person decides.
  it("does NOT write the original back when the file on disk is not what was written (another program changed it)", () => {
    withFile((file, dir) => {
      let checked = false;
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, {
        check: () => ((checked = true), undefined),
        hooks: { afterRename: (f) => writeFileSync(f, "changed by someone else\n") },
      });

      expect(outcome).toEqual({
        status: "changed-after-write",
        reason: "the file on disk does not have the bytes LogPilot wrote: another program may have changed it",
      });
      expect(readFileSync(file, "utf8")).toBe("changed by someone else\n"); // the other change is kept
      expect(checked).toBe(false); // the rules were not run on someone else's content
      expect(readdirSync(dir).sort()).toEqual(["app.js", "other.js"]);
    });
  });

  it("does NOT write the original back when the file cannot be read back to check it", () => {
    withFile((file) => {
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, { hooks: { afterRename: (f) => rmSync(f) } });

      expect(outcome).toEqual({ status: "changed-after-write", reason: "it could not be read back to check it (ENOENT)" });
    });
  });

  it("reports loudly when writing back the original fails too", () => {
    withFile((file) => {
      let attempts = 0;
      const rename = (from: string, to: string) => {
        attempts++;
        if (attempts === 1) return renameSync(from, to); // the fix is written...
        throw failure("EXDEV"); //                          ...but the restore fails
      };
      const outcome = replaceFile(file, ORIGINAL, REPLACEMENT, { check: () => "the fixed code does not parse", hooks: { rename } });

      expect(outcome).toEqual({
        status: "restore-failed",
        reason: "the fixed code does not parse; writing back the original also failed: it could not be replaced (EXDEV)",
      });
    });
  });
});

describe("leftoverTempFiles", () => {
  it("lists LogPilot's temporary files and nothing else, and deletes nothing", () => {
    withFolder((dir) => {
      const names = [".app.js.logpilot-1a2b3c4d.tmp", ".my file.ts.logpilot-00ff00ff.tmp", "app.js", "app.js.tmp", ".app.js.logpilot-xyz.tmp", ".app.js.logpilot-1a2b3c4d.tmp.bak"];
      for (const name of names) writeFileSync(path.join(dir, name), "x");

      expect(leftoverTempFiles([dir, dir, path.join(dir, "missing")]).map((f) => path.basename(f))).toEqual([
        ".app.js.logpilot-1a2b3c4d.tmp",
        ".my file.ts.logpilot-00ff00ff.tmp",
      ]);
      expect(readdirSync(dir).sort()).toEqual([...names].sort());
    });
  });
});
