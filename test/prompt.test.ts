// Tests for src/prompt.ts: answers typed in a terminal in raw mode. The terminal is simulated: keys
// are pushed as text, and everything printed is collected.

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Prompt } from "../src/prompt.js";

/** A prompt on a fake terminal. `type` pushes keys as the terminal would send them. */
function terminal() {
  const input = new PassThrough();
  let rawMode: boolean | undefined;
  const fakeInput = Object.assign(input, { setRawMode: (mode: boolean) => (rawMode = mode) });
  let printed = "";
  const prompt = new Prompt(fakeInput, { write: (text: string) => (printed += text) }, 30);
  prompt.start();
  return {
    prompt,
    type: (keys: string) => input.write(keys),
    printed: () => printed,
    rawMode: () => rawMode,
  };
}

describe("Prompt.ask", () => {
  it("accepts y, n, s and q (also in capitals and with spaces), and echoes what is typed", async () => {
    for (const [keys, expected] of [["y\r", "y"], ["N\r", "n"], [" s \r", "s"], ["q\n", "q"]] as const) {
      const t = terminal();
      const answer = t.prompt.ask("Apply this fix?");
      t.type(keys);
      expect(await answer).toBe(expected);
      expect(t.printed()).toBe(`Apply this fix?\n> ${keys.replace(/[\r\n]/g, "")}\n`);
      t.prompt.stop();
    }
  });

  it("asks again after Enter alone, a wrong answer, or ?, and handles Backspace", async () => {
    const t = terminal();
    const answer = t.prompt.ask("Apply this fix?");
    t.type("\r");
    t.type("yes\r");
    t.type("?\r");
    t.type("x\u007fn\r"); // x, Backspace, n
    expect(await answer).toBe("n");
    expect(t.printed()).toContain("(Enter alone does nothing: type y, n, s or q, then Enter. ? = help)\n> ");
    expect(t.printed()).toContain('("yes" is not an answer: type y, n, s or q, then Enter. ? = help)\n> ');
    expect(t.printed()).toContain("y writes this fix, n skips it, s skips the rest of this file, q quits");
    expect(t.printed()).toContain("x\b \bn\n");
  });

  it("treats Windows' Enter (\\r\\n) as one Enter, and ignores arrow keys", async () => {
    const t = terminal();
    const answer = t.prompt.ask("Apply this fix?");
    // A wrong answer with \r\n: the \n must not count as a second, empty Enter.
    t.type("\u001b[A\u001b[Dx\r\nq\r\n");
    expect(await answer).toBe("q");
    expect(t.printed()).toBe('Apply this fix?\n> x\n("x" is not an answer: type y, n, s or q, then Enter. ? = help)\n> q\n');
    expect(t.printed()).not.toContain("Enter alone");
  });

  it("answers 'interrupt' at Ctrl+C, and 'q' at Ctrl+D on an empty line or when the input ends", async () => {
    const ctrlC = terminal();
    const a = ctrlC.prompt.ask("?");
    ctrlC.type("y\u0003");
    expect(await a).toBe("interrupt");
    expect(ctrlC.printed().endsWith("^C\n")).toBe(true);

    const ctrlD = terminal();
    const b = ctrlD.prompt.ask("?");
    ctrlD.type("\u0004");
    expect(await b).toBe("q");

    const ended = terminal();
    const c = ended.prompt.ask("?");
    ended.type("y");
    (ended.prompt as unknown as { input: PassThrough }).input.end();
    expect(await c).toBe("q");
  });

  it("does not count keys typed before the question", async () => {
    const t = terminal();
    t.type("y"); // no question open: ignored
    await new Promise((resolve) => setTimeout(resolve, 10));
    const answer = t.prompt.ask("Apply this fix?");
    t.type("\r");
    t.type("n\r");
    expect(await answer).toBe("n"); // the early "y" did not become part of the answer
  });

  it("uses raw mode while running, and gives the terminal back afterwards", () => {
    const t = terminal();
    expect(t.rawMode()).toBe(true);
    t.prompt.stop();
    expect(t.rawMode()).toBe(false);
  });
});

describe("Prompt.writing: keys pressed while LogPilot writes", () => {
  it("ignores typed keys (never an answer), prints none of them, and reports them", async () => {
    const t = terminal();
    const before = t.printed();
    const { result, interrupted, typed } = await t.prompt.writing(() => {
      t.type("y\r"); // pressed during the (synchronous) write: queued, read after it
      return "written";
    });
    expect([result, interrupted, typed]).toEqual(["written", false, true]);
    expect(t.printed()).toBe(before); // nothing was echoed

    const next = t.prompt.ask("Fix 2?");
    t.type("n\r");
    expect(await next).toBe("n"); // the "y" typed during the write did not answer this
  });

  it("notes Ctrl+C pressed during the write, after the write has finished", async () => {
    const t = terminal();
    let finished = false;
    const { interrupted, typed } = await t.prompt.writing(() => {
      t.type("\u0003");
      finished = true;
    });
    expect([finished, interrupted, typed]).toEqual([true, true, false]);
  });

  it("reports nothing when no key was pressed", async () => {
    const t = terminal();
    expect(await t.prompt.writing(() => 1)).toEqual({ result: 1, interrupted: false, typed: false });
  });

  it("a real SIGINT during a write is noted; at a question it answers 'interrupt'", async () => {
    const t = terminal();
    const { interrupted } = await t.prompt.writing(() => t.prompt.signal());
    expect(interrupted).toBe(true);

    const u = terminal();
    const answer = u.prompt.ask("?");
    u.prompt.signal();
    expect(await answer).toBe("interrupt");
  });
});
