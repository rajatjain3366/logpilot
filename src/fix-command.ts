// `logpilot fix`: shows each validated LP003 fix, asks the user, and writes a file only after "y".
// The terminal is reached only through FixIO (prompt.ts), so tests can play the user.
//
// The rules (approved for Milestone 4):
// - Only a git repository, and only files that pass every check of fix-preconditions.ts.
// - One write per file: the fixes accepted for a file are checked together (validateFixSet), then
//   written at once (fix-write.ts), then read back and checked again.
// - q or Ctrl+C at a question stops at once; files already written stay written; fixes accepted in
//   the current file are not written. Ctrl+C during a write stops right after that file.
// - Every message about what happened is built from what really happened (the run's state), so
//   "Nothing was written" is said only when nothing was.
// - If, after a write, the file is not what LogPilot wrote (another program?), nothing is written
//   back: LogPilot stops (exit code 2) and shows the git commands, so a person decides.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { applyEdits } from "./fix-edits.js";
import { checkFile, openRepository, type FixTarget, type Repository } from "./fix-preconditions.js";
import { validateFixSet, type FixToCheck } from "./fix-validate.js";
import { leftoverTempFiles, replaceFile, type ReplaceOptions, type WriteOutcome } from "./fix-write.js";
import { headCommit } from "./git.js";
import type { Answer, FixIO } from "./prompt.js";
import { scanPath, scanRootOf, type ScanOptions } from "./scanner.js";
import type { Finding } from "./types.js";

/** Exit codes of `logpilot fix`. */
export const FIX_EXIT = {
  /** Finished: every accepted fix was written and checked (also when none was accepted, or after q). */
  OK: 0,
  /** At least one accepted fix was not written (the file changed, was locked, or failed its check). */
  NOT_ALL_WRITTEN: 1,
  /** LogPilot could not run, or stopped because a file needs a person's attention. */
  STOPPED: 2,
  /** Stopped by Ctrl+C (128 + the number of SIGINT, as shells do). */
  INTERRUPTED: 130,
} as const;

export interface FixRunOptions {
  /** The path to fix, as the user typed it, and the folder it is relative to. */
  target: string;
  cwd: string;
  /** Which files are scanned and which rules run (from the config file and the command line). */
  scanOptions: Omit<ScanOptions, "fixPreview" | "keepTexts">;
  io: FixIO;
  toolVersion: string;
  /** Tests only: options for the writer (fault injection), and a replacement post-write check. */
  testHooks?: { replace?: ReplaceOptions["hooks"]; postWriteCheck?: () => string | undefined };
}

/** What happened to one fix. */
type FixStatus = "applied" | "declined" | "skipped-file" | "not-asked" | "not-written" | "failed";

interface FixState {
  finding: Finding;
  status: FixStatus;
  reason?: string;
}

interface FileState {
  displayPath: string;
  absolutePath: string;
  fixes: FixState[];
  target?: FixTarget;
  status: "written" | "not-written" | "restored" | "restore-failed" | "changed-after-write" | "not-asked" | "nothing-accepted";
  reason?: string;
  bytesAfter?: Buffer;
}

/** The JSON record of a run (--output). */
export interface FixRunRecord {
  schema: "logpilot-fix-run";
  schemaVersion: 1;
  tool: { name: "logpilot"; version: string };
  scannedPath: string;
  gitHead: string | null;
  exitCode: number;
  stoppedBy: "quit" | "ctrl-c" | "problem" | null;
  summary: { offered: number; applied: number; declined: number; skipped: number; notAsked: number; notWritten: number; failed: number };
  files: { file: string; status: string; reason: string | null; sha256Before: string | null; sha256After: string | null; undo: string[] }[];
  fixes: { file: string; line: number; column: number; ruleId: string; status: FixStatus; reason: string | null; description: string | null; diff: string | null }[];
  leftoverTempFiles: string[];
}

export interface FixRunResult {
  exitCode: number;
  /** Set when the run could not start: printed by the CLI as "Error: ...". */
  error?: string;
  record?: FixRunRecord;
}

/** Runs `logpilot fix`. Never writes anything before the user's "y". */
export async function runFix(options: FixRunOptions): Promise<FixRunResult> {
  const { io } = options;
  const scanRoot = scanRootOf(path.resolve(options.cwd, options.target));
  const opened = openRepository(scanRoot);
  if (!opened.ok) return { exitCode: FIX_EXIT.STOPPED, error: `${opened.reason}. Nothing was changed.` };
  const repository = opened.repository;

  let scan;
  try {
    scan = scanPath(options.target, options.cwd, { ...options.scanOptions, fixPreview: true, keepTexts: true });
  } catch (error) {
    return { exitCode: FIX_EXIT.STOPPED, error: `${(error as Error).message}. Nothing was changed.` };
  }

  // The fixes that can be offered, grouped by file (in report order).
  const files: FileState[] = [];
  for (const finding of scan.findings) {
    if (finding.fix?.status !== "available") continue;
    let file = files.find((f) => f.displayPath === finding.file);
    if (file === undefined) {
      file = { displayPath: finding.file, absolutePath: path.join(scanRoot, ...finding.file.split("/")), fixes: [], status: "nothing-accepted" };
      files.push(file);
    }
    file.fixes.push({ finding, status: "not-asked" });
  }

  // Each file must pass every check, and still have exactly the text that was scanned.
  for (const file of files) {
    const checked = checkFile(file.absolutePath, scanRoot, repository);
    let reason = checked.ok ? undefined : checked.reason;
    if (checked.ok && checked.target.text !== scan.texts?.get(file.displayPath)) reason = "it changed while LogPilot was scanning it";
    if (reason !== undefined) {
      file.status = "not-asked";
      file.reason = reason;
      for (const fix of file.fixes) fix.reason = `not asked: ${reason}`;
    } else if (checked.ok) {
      file.target = checked.target;
    }
  }

  const leftovers = leftoverTempFiles(files.map((f) => path.dirname(f.absolutePath)));
  const run = new Run(io, repository, options, files, leftovers);
  return run.go();
}

/** One run: the files, what happened to each fix, and the messages built from that. */
class Run {
  private stoppedBy: FixRunRecord["stoppedBy"] = null;
  private exitCode: number = FIX_EXIT.OK;

  constructor(
    private readonly io: FixIO,
    private readonly repository: Repository,
    private readonly options: FixRunOptions,
    private readonly files: FileState[],
    private readonly leftovers: string[],
  ) {}

  async go(): Promise<FixRunResult> {
    const io = this.io;
    const offered = this.files.filter((f) => f.target !== undefined);
    const count = offered.reduce((sum, f) => sum + f.fixes.length, 0);

    for (const leftover of this.leftovers) {
      io.print(`Note: ${this.display(leftover)} is a temporary file left by an interrupted LogPilot run. Delete it if you do not need it.`);
    }
    for (const file of this.files.filter((f) => f.status === "not-asked")) {
      io.print(`Not asked: ${plural(file.fixes.length, "fix", "fixes")} in ${file.displayPath}, because ${file.reason}.`);
    }
    if (count === 0) {
      io.print(this.files.length === 0 ? "No fixes to offer: LogPilot found no LP003 finding with a fix here." : "No fixes to offer.");
      io.print("Nothing was written.");
      return this.finish();
    }
    io.print(
      `LogPilot has ${plural(count, "fix", "fixes")} for ${plural(offered.length, "file")}. Nothing is written until you answer y; ` +
        "a file is written once, after its last question.",
    );

    let number = 0;
    for (const file of offered) {
      const accepted: FixState[] = [];
      let skipRest = false;
      for (const fix of file.fixes) {
        number++;
        if (skipRest) {
          fix.status = "skipped-file";
          continue;
        }
        this.showFix(fix.finding, number, count);
        const answer: Answer = await io.ask("Apply this fix?  y = yes   n = no   s = skip the rest of this file   q = quit   ? = help");
        if (answer === "y") {
          accepted.push(fix);
        } else if (answer === "n") {
          fix.status = "declined";
        } else if (answer === "s") {
          fix.status = "skipped-file";
          skipRest = true;
        } else {
          // q or Ctrl+C: stop now. The fixes accepted in this file are not written.
          this.stoppedBy = answer === "q" ? "quit" : "ctrl-c";
          for (const done of accepted) {
            done.status = "not-written";
            done.reason = answer === "q" ? "you quit before this file was written" : "you pressed Ctrl+C before this file was written";
          }
          this.stopAtQuestion(file, accepted.length);
          return this.finish();
        }
      }
      if (accepted.length > 0) {
        const stop = await this.write(file, accepted);
        if (stop) return this.finish();
      }
    }
    io.print("");
    io.print(this.whatWasWritten());
    return this.finish();
  }

  /** One fix, as the user sees it before the question. */
  private showFix(finding: Finding, number: number, count: number): void {
    const fix = finding.fix;
    const lines = [
      "",
      `[${number}/${count}] ${finding.file}:${finding.line}:${finding.column}  ${finding.ruleId} ${finding.ruleName} (severity ${finding.severity}, confidence ${finding.confidence})`,
      `  ${fix?.description ?? ""}`,
    ];
    if (fix?.logger !== undefined) lines.push(`  Logger: ${fix.logger.call} (confidence ${fix.logger.confidence}: ${fix.logger.evidence})`);
    lines.push(...(fix?.diff ?? "").trimEnd().split("\n").map((line) => `    ${line}`));
    for (const note of fix?.notes ?? []) lines.push(`  Note: ${note}`);
    this.io.print(lines.join("\n"));
  }

  /** Writes the accepted fixes of one file. Returns true when the run must stop. */
  private async write(file: FileState, accepted: FixState[]): Promise<boolean> {
    const io = this.io;
    const target = file.target as FixTarget;
    const fixes: FixToCheck[] = accepted.map((fix) => ({
      finding: fix.finding,
      edits: fix.finding.fix?.edits ?? [],
      safety: fix.finding.fix?.safety ?? { errorName: "", loggerName: "" },
    }));
    const problem = validateFixSet(file.absolutePath, file.displayPath, target.text, fixes);
    if (problem !== undefined) {
      // The fixes were fine one by one but not together: a LogPilot bug. Nothing is written.
      this.markNotWritten(file, accepted, "not-written", `LogPilot's fixes for this file failed their check together (${problem}); this is a LogPilot bug, please report it`, "failed");
      io.print(`Not written: ${file.displayPath}, because ${file.reason}.`);
      return false;
    }
    const newText = applyEdits(target.text, fixes.flatMap((fix) => fix.edits));
    const replacement = Buffer.from(newText, "utf8");
    const hooks = this.options.testHooks;
    // After the write: the bytes on disk must decode to the fixed text, and the rules must agree again.
    const check = hooks?.postWriteCheck ?? ((written: Buffer) => (written.toString("utf8") === newText ? validateFixSet(file.absolutePath, file.displayPath, target.text, fixes) : "the written bytes are not the fixed text"));

    const { result: outcome, interrupted, typed } = await io.writing(() => replaceFile(file.absolutePath, target.bytes, replacement, { check, hooks: hooks?.replace }));
    if (typed) io.print("(Keys you pressed while LogPilot was writing were ignored: they are not answers to any question.)");
    const stop = this.afterWrite(file, accepted, outcome, replacement);
    if (stop) return true;
    if (interrupted) {
      this.stoppedBy = "ctrl-c";
      this.exitCode = FIX_EXIT.INTERRUPTED;
      io.print("");
      io.print(`Stopped (Ctrl+C), after ${file.displayPath} was written completely.`);
      io.print(this.whatWasWritten());
      return true;
    }
    return false;
  }

  /** Records and reports a write's outcome. Returns true when the run must stop. */
  private afterWrite(file: FileState, accepted: FixState[], outcome: WriteOutcome, replacement: Buffer): boolean {
    const io = this.io;
    if (outcome.status === "written") {
      file.status = "written";
      file.bytesAfter = replacement;
      for (const fix of accepted) fix.status = "applied";
      io.print(`Written: ${file.displayPath} (${plural(accepted.length, "fix", "fixes")}). Checked after writing: it parses, the fixed findings are gone, and nothing else changed.`);
      return false;
    }
    if (outcome.status === "not-written") {
      this.markNotWritten(file, accepted, "not-written", outcome.reason, "not-written");
      io.print(`Not written: ${file.displayPath}, because ${outcome.reason}.`);
      return false;
    }
    if (outcome.status === "restored") {
      this.markNotWritten(file, accepted, "restored", outcome.reason, "failed");
      io.print(`Not kept: ${file.displayPath} failed LogPilot's check after writing (${outcome.reason}), so its original content was written back and checked. This is a LogPilot bug, please report it.`);
      return false;
    }

    // The file needs a person: stop the whole run.
    this.stoppedBy = "problem";
    this.exitCode = FIX_EXIT.STOPPED;
    file.status = outcome.status;
    file.reason = outcome.reason;
    for (const fix of accepted) {
      fix.status = "failed";
      fix.reason = outcome.reason;
    }
    const [diff, checkout] = this.undoCommands(file);
    io.print("");
    if (outcome.status === "changed-after-write") {
      io.print(
        `STOPPED: after LogPilot wrote ${file.displayPath}, ${outcome.reason}. LogPilot did NOT write anything back, ` +
          "so a change made by someone else is not lost. Please look at the file and decide:",
      );
      io.print(`  ${diff}        (what changed since the last commit)`);
      io.print(`  ${checkout}    (go back to the last commit; this also removes any other change to this file)`);
    } else {
      io.print(`STOPPED: ${file.displayPath} failed LogPilot's check after writing, and writing back its original content failed too (${outcome.reason}).`);
      io.print(`The file may be wrong. Restore it with:  ${checkout}`);
    }
    io.print(this.whatWasWritten());
    return true;
  }

  private markNotWritten(file: FileState, accepted: FixState[], status: FileState["status"], reason: string, fixStatus: FixStatus): void {
    file.status = status;
    file.reason = reason;
    for (const fix of accepted) {
      fix.status = fixStatus;
      fix.reason = reason;
    }
    this.exitCode = Math.max(this.exitCode, FIX_EXIT.NOT_ALL_WRITTEN);
  }

  /** The message for q or Ctrl+C at a question. */
  private stopAtQuestion(file: FileState, acceptedInFile: number): void {
    const io = this.io;
    if (this.stoppedBy === "ctrl-c") this.exitCode = FIX_EXIT.INTERRUPTED;
    io.print("");
    io.print(this.stoppedBy === "quit" ? "Quit." : "Stopped (Ctrl+C).");
    if (acceptedInFile > 0) {
      io.print(`The ${plural(acceptedInFile, "fix", "fixes")} you accepted in ${file.displayPath} ${acceptedInFile === 1 ? "was" : "were"} not written.`);
    }
    io.print(this.whatWasWritten());
  }

  /**
   * Exactly what this run wrote, from its state: "Nothing was written." only when no file was
   * written; otherwise each written file, and how to see and undo the changes.
   */
  private whatWasWritten(): string {
    const written = this.files.filter((f) => f.status === "written");
    if (written.length === 0) return "Nothing was written.";
    const fixCount = written.reduce((sum, f) => sum + f.fixes.filter((fix) => fix.status === "applied").length, 0);
    const list = written.map((f) => `${f.displayPath} (${plural(f.fixes.filter((fix) => fix.status === "applied").length, "fix", "fixes")})`).join(", ");
    const lines = [
      `Written: ${plural(fixCount, "fix", "fixes")} in ${plural(written.length, "file")}: ${list}. Nothing else was changed.`,
      "To see or undo LogPilot's changes:",
    ];
    for (const file of written) {
      const [diff, checkout] = this.undoCommands(file);
      lines.push(`  ${diff}`, `  ${checkout}`);
    }
    lines.push("Now run your tests (for example npm test).");
    return lines.join("\n");
  }

  /** `git diff -- <file>` and `git checkout -- <file>`, usable from the folder LogPilot was run in. */
  private undoCommands(file: FileState): [string, string] {
    const fromCwd = path.relative(this.options.cwd, file.absolutePath);
    const cwdFromRoot = path.relative(this.repository.root, safeRealpath(this.options.cwd));
    const cwdInRepository = !cwdFromRoot.startsWith("..") && !path.isAbsolute(cwdFromRoot);
    if (cwdInRepository && !path.isAbsolute(fromCwd)) {
      const shown = fromCwd.split(path.sep).join("/");
      return [`git diff -- "${shown}"`, `git checkout -- "${shown}"`];
    }
    const root = this.repository.root.split(path.sep).join("/");
    const inRepository = file.target?.repositoryPath ?? file.displayPath;
    return [`git -C "${root}" diff -- "${inRepository}"`, `git -C "${root}" checkout -- "${inRepository}"`];
  }

  /** A path for messages: relative to the folder LogPilot was run in, with "/". */
  private display(file: string): string {
    return path.relative(this.options.cwd, file).split(path.sep).join("/");
  }

  private finish(): FixRunResult {
    return { exitCode: this.exitCode, record: this.record() };
  }

  private record(): FixRunRecord {
    const all = this.files.flatMap((f) => f.fixes.map((fix) => ({ file: f, fix })));
    const countOf = (...statuses: FixStatus[]) => all.filter(({ fix }) => statuses.includes(fix.status)).length;
    let gitHead: string | null = null;
    try {
      gitHead = headCommit(this.repository.root) ?? null;
    } catch {
      gitHead = null; // the record still says everything else
    }
    return {
      schema: "logpilot-fix-run",
      schemaVersion: 1,
      tool: { name: "logpilot", version: this.options.toolVersion },
      scannedPath: this.options.target,
      gitHead,
      exitCode: this.exitCode,
      stoppedBy: this.stoppedBy,
      summary: {
        offered: all.filter(({ file }) => file.target !== undefined).length,
        applied: countOf("applied"),
        declined: countOf("declined"),
        skipped: countOf("skipped-file"),
        notAsked: countOf("not-asked"),
        notWritten: countOf("not-written"),
        failed: countOf("failed"),
      },
      files: this.files.map((f) => ({
        file: f.displayPath,
        status: f.status,
        reason: f.reason ?? null,
        sha256Before: f.target === undefined ? null : sha256(f.target.bytes),
        sha256After: f.bytesAfter === undefined ? null : sha256(f.bytesAfter),
        undo: f.status === "written" || f.status === "changed-after-write" || f.status === "restore-failed" ? this.undoCommands(f) : [],
      })),
      fixes: all.map(({ file, fix }) => ({
        file: file.displayPath,
        line: fix.finding.line,
        column: fix.finding.column,
        ruleId: fix.finding.ruleId,
        status: fix.status,
        reason: fix.reason ?? null,
        description: fix.finding.fix?.description ?? null,
        diff: fix.finding.fix?.diff ?? null,
      })),
      leftoverTempFiles: this.leftovers.map((f) => this.display(f)),
    };
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The real path of a folder, or the path itself if it cannot be resolved. */
function safeRealpath(folder: string): string {
  try {
    return realpathSync.native(folder);
  } catch {
    return folder; // a folder that cannot be resolved is compared as it is
  }
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
