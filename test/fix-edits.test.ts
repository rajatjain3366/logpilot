// Tests for the fix edit tools: applying text edits in memory, and the unified diff shown to users.

import { describe, expect, it } from "vitest";
import { applyEdits, isInsertOnly, sortedEdits, unifiedDiff } from "../src/fix-edits.js";

const lines = (...l: string[]) => l.join("\n") + "\n";
const FILE = lines("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p");
/** The offset where 0-based line `n` of FILE starts (every line is one letter plus \n). */
const at = (n: number) => n * 2;

describe("applyEdits", () => {
  it("applies insertions and replacements with offsets into the ORIGINAL text, in any order", () => {
    const text = "hello world";
    expect(applyEdits(text, [{ start: 11, end: 11, newText: "!" }, { start: 0, end: 5, newText: "goodbye" }])).toBe("goodbye world!");
  });

  it("refuses overlapping edits, two insertions at the same place, and edits outside the text", () => {
    expect(() => applyEdits("abcdef", [{ start: 1, end: 4, newText: "x" }, { start: 3, end: 5, newText: "y" }])).toThrow(/overlap/);
    expect(() => applyEdits("abcdef", [{ start: 2, end: 2, newText: "x" }, { start: 2, end: 2, newText: "y" }])).toThrow(/overlap/);
    expect(() => applyEdits("abc", [{ start: 2, end: 9, newText: "x" }])).toThrow(/outside/);
    expect(() => applyEdits("abc", [{ start: 2, end: 1, newText: "x" }])).toThrow(/outside/);
  });

  it("sorts edits by position", () => {
    expect(sortedEdits("abcdef", [{ start: 4, end: 4, newText: "b" }, { start: 1, end: 1, newText: "a" }]).map((e) => e.start)).toEqual([1, 4]);
  });

  it("tells insert-only edits apart from edits that remove or replace text", () => {
    expect(isInsertOnly([{ start: 3, end: 3, newText: "x" }])).toBe(true);
    expect(isInsertOnly([{ start: 3, end: 3, newText: "x" }, { start: 5, end: 6, newText: "" }])).toBe(false);
  });
});

describe("unifiedDiff", () => {
  it("shows an inserted line with 3 lines of context and git's hunk header", () => {
    // Insert a new line before line 6 ("f", 0-based 5).
    expect(unifiedDiff("src/x.js", FILE, [{ start: at(5), end: at(5), newText: "NEW\n" }])).toBe(
      lines("--- a/src/x.js", "+++ b/src/x.js", "@@ -3,6 +3,7 @@", " c", " d", " e", "+NEW", " f", " g", " h"),
    );
  });

  it("shows a change inside a line as the old line removed and the new line added", () => {
    expect(unifiedDiff("x.js", "one\ncatch {\ntwo\n", [{ start: 9, end: 9, newText: " (err)" }])).toBe(
      lines("--- a/x.js", "+++ b/x.js", "@@ -1,3 +1,3 @@", " one", "-catch {", "+catch (err) {", " two"),
    );
  });

  it("puts two edits on one line, or on nearby lines, into one hunk", () => {
    const text = "x\ncatch {\n  res.end()\n}\n";
    const diff = unifiedDiff("x.js", text, [
      { start: 7, end: 7, newText: " (err)" }, // after "catch" on line 2
      { start: 10, end: 10, newText: "  console.error(err)\n" }, // before line 3 ("x\n" is 2, "catch {\n" is 8 characters)
    ]);
    expect(diff).toBe(lines("--- a/x.js", "+++ b/x.js", "@@ -1,4 +1,5 @@", " x", "-catch {", "+catch (err) {", "+  console.error(err)", "   res.end()", " }"));
  });

  it("gives far-apart changes their own hunks, and shifts later new-file line numbers", () => {
    const diff = unifiedDiff("x.js", FILE, [
      { start: at(1), end: at(1), newText: "ONE\nTWO\n" }, // before line 2 ("b")
      { start: at(14), end: at(14), newText: "THREE\n" }, //  before line 15 ("o")
    ]);
    expect(diff).toBe(
      lines(
        "--- a/x.js",
        "+++ b/x.js",
        "@@ -1,4 +1,6 @@",
        " a",
        "+ONE",
        "+TWO",
        " b",
        " c",
        " d",
        "@@ -12,5 +14,6 @@",
        " l",
        " m",
        " n",
        "+THREE",
        " o",
        " p",
      ),
    );
  });

  it("shows CRLF files with plain new lines (the diff is for reading; the edits are exact)", () => {
    const crlf = "a\r\nb\r\nc\r\n";
    const diff = unifiedDiff("x.js", crlf, [{ start: 3, end: 3, newText: "NEW\r\n" }]);
    expect(diff).toBe(lines("--- a/x.js", "+++ b/x.js", "@@ -1,3 +1,4 @@", " a", "+NEW", " b", " c"));
    expect(diff).not.toContain("\r");
  });

  it("handles an insertion at the very start and a file without a final new line", () => {
    expect(unifiedDiff("x.js", "a\nb", [{ start: 0, end: 0, newText: "TOP\n" }])).toBe(
      lines("--- a/x.js", "+++ b/x.js", "@@ -1,2 +1,3 @@", "+TOP", " a", " b"),
    );
  });

  it("is empty when the edits change nothing", () => {
    expect(unifiedDiff("x.js", FILE, [])).toBe("");
    expect(unifiedDiff("x.js", FILE, [{ start: 2, end: 3, newText: "b" }])).toBe("");
  });
});
