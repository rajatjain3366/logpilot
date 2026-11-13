// Asking the user in a terminal, for `logpilot fix`. The terminal is in RAW MODE for the whole run:
// every key arrives at once, as bytes, and nothing is printed unless this module prints it.
//
// Why raw mode, and why not Node's readline (Milestone 4 spike, checked in Git Bash with and
// without winpty, VS Code's terminal and PowerShell):
// - In raw mode, Ctrl+C is not a signal but a byte (0x03). At a question it means "stop now".
//   During a write it must wait until the write has finished, so it is only noted then.
// - Keys pressed while LogPilot is writing are queued by the terminal and arrive after the write.
//   They must never answer the next question (a "y" typed during a write would approve a fix
//   nobody looked at). readline would also print them. Here they are read, not printed, ignored,
//   and reported.
// - At a question, only y, n, s, q (and ? for help) are answers. Enter alone does nothing.

/** An answer to "Apply this fix?". "interrupt" = Ctrl+C at the question. */
export type Answer = "y" | "n" | "s" | "q" | "interrupt";

/** What `logpilot fix` needs from the terminal (fix-command.ts); tests pass a fake. */
export interface FixIO {
  /** Prints text followed by a new line. */
  print(text: string): void;
  /** Prints `question` and waits for a valid answer. */
  ask(question: string): Promise<Answer>;
  /**
   * Runs `work` (a synchronous write) and then reads the keys pressed meanwhile: `interrupted` when
   * one was Ctrl+C, `typed` when any other key was pressed (those are ignored, never answers).
   */
  writing<T>(work: () => T): Promise<{ result: T; interrupted: boolean; typed: boolean }>;
}

/** The parts of process.stdin and process.stdout that Prompt uses. */
export interface PromptInput {
  setRawMode?(mode: boolean): unknown;
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "end", listener: () => void): unknown;
  resume(): unknown;
  pause(): unknown;
}
export interface PromptOutput {
  write(text: string): unknown;
}

const HELP = "y writes this fix, n skips it, s skips the rest of this file, q quits (files already written stay written).";
/** How long to let keys pressed during a write arrive before deciding what they were. */
const SETTLE_MS = 150;

/** Answers typed in a terminal in raw mode (see the top of this file). */
export class Prompt implements FixIO {
  private phase: "idle" | "question" | "writing" = "idle";
  private line = "";
  private afterCarriageReturn = false;
  private escape: "none" | "start" | "sequence" = "none";
  private interrupted = false;
  private typed = false;
  private answer?: (answer: Answer) => void;
  private readonly onData = (chunk: Buffer | string) => this.read(chunk.toString());
  private readonly onEnd = () => this.answer?.("q"); // the input ended: quit

  constructor(
    private readonly input: PromptInput,
    private readonly output: PromptOutput,
    private readonly settleMs = SETTLE_MS,
  ) {}

  /** Puts the terminal in raw mode and starts reading. */
  start(): void {
    this.input.setRawMode?.(true);
    this.input.on("data", this.onData);
    this.input.on("end", this.onEnd);
    this.input.resume();
  }

  /** Gives the terminal back as it was. Safe to call more than once. */
  stop(): void {
    this.input.off("data", this.onData);
    this.input.off("end", this.onEnd);
    this.input.setRawMode?.(false);
    this.input.pause();
  }

  print(text: string): void {
    this.output.write(`${text}\n`);
  }

  /** A real SIGINT (not a key in raw mode, e.g. `kill -INT` on Linux): the same as Ctrl+C. */
  signal(): void {
    if (this.phase === "question") this.answer?.("interrupt");
    else this.interrupted = true;
  }

  ask(question: string): Promise<Answer> {
    // Keys pressed before this point were never added to the line (see read()): they cannot count.
    this.output.write(`${question}\n> `);
    this.phase = "question";
    return new Promise((resolve) => {
      this.answer = (answer) => {
        this.answer = undefined;
        this.phase = "idle";
        resolve(answer);
      };
      if (this.interrupted) this.answer("interrupt"); // Ctrl+C was pressed just before the question
    });
  }

  async writing<T>(work: () => T): Promise<{ result: T; interrupted: boolean; typed: boolean }> {
    this.phase = "writing";
    this.typed = false;
    const result = work(); // synchronous: keys pressed now are queued and read below
    await new Promise((resolve) => setTimeout(resolve, this.settleMs));
    this.phase = "idle";
    return { result, interrupted: this.interrupted, typed: this.typed };
  }

  /** Handles the keys in `text` (one or more characters). */
  private read(text: string): void {
    for (const char of text) {
      if (this.phase !== "question") {
        // Not at a question (writing, or printing): note Ctrl+C, ignore everything else, print nothing.
        if (char === "\u0003") this.interrupted = true;
        else this.typed = true;
        continue;
      }
      // Once a key completes the answer, the phase is no longer "question", so the rest of this chunk
      // (typed ahead) is handled by the branch above: noted, ignored, not printed.
      this.key(char);
    }
  }

  /** One key at a question. */
  private key(char: string): void {
    // Escape sequences (arrow keys, function keys): ESC [ ... final letter, or ESC O letter. Ignored.
    if (this.escape === "start") {
      this.escape = char === "[" || char === "O" ? "sequence" : "none";
      return;
    }
    if (this.escape === "sequence") {
      if (char >= "@" && char <= "~") this.escape = "none";
      return;
    }
    const lf = char === "\n";
    const afterCr = this.afterCarriageReturn;
    this.afterCarriageReturn = char === "\r";
    if (char === "\u001b") this.escape = "start";
    else if (char === "\u0003") {
      this.output.write("^C\n");
      this.answer?.("interrupt");
    } else if (char === "\u0004") {
      if (this.line === "") {
        this.output.write("\n");
        this.answer?.("q"); // Ctrl+D on an empty line: the end of input, so quit
      }
    } else if (char === "\r" || lf) {
      if (lf && afterCr) return; // "\r\n" is one Enter
      this.submit();
    } else if (char === "\u007f" || char === "\b") {
      if (this.line !== "") {
        this.line = [...this.line].slice(0, -1).join("");
        this.output.write("\b \b");
      }
    } else if (char >= " ") {
      this.line += char;
      this.output.write(char);
    }
  }

  /** Enter at a question. */
  private submit(): void {
    const answer = this.line.trim().toLowerCase();
    this.line = "";
    this.output.write("\n");
    if (answer === "y" || answer === "n" || answer === "s" || answer === "q") {
      this.answer?.(answer);
      return;
    }
    if (answer === "?") this.output.write(`${HELP}\n> `);
    else if (answer === "") this.output.write("(Enter alone does nothing: type y, n, s or q, then Enter. ? = help)\n> ");
    else this.output.write(`("${answer}" is not an answer: type y, n, s or q, then Enter. ? = help)\n> `);
  }
}
