// Fix edits: applying text edits to a string, and showing them as a unified diff.
// Pure functions on strings: nothing here reads or writes files. A fix preview is applied only
// to a copy of the file's text in memory, to check it and to show the diff.
//
// A "unified diff" is the format `git diff` prints:
//   --- a/src/app.js            the file before
//   +++ b/src/app.js            the file after
//   @@ -12,6 +12,7 @@           6 lines from line 12 of the old file become 7 lines from line 12
//        unchanged line          (a space: context, the same in both)
//   +    added line             (+: only in the new file)
//   -    removed line           (-: only in the old file)

import type { TextEdit } from "./types.js";

/** Unchanged lines shown around each change in a diff (git's default). */
const CONTEXT_LINES = 3;

/** Edits sorted by position. Throws if one is outside the text, inverted, or overlaps another. */
export function sortedEdits(text: string, edits: readonly TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  sorted.forEach((edit, i) => {
    if (edit.start < 0 || edit.end > text.length || edit.start > edit.end) {
      throw new Error(`edit ${edit.start}-${edit.end} is outside the text (length ${text.length})`);
    }
    const previous = sorted[i - 1];
    // Two insertions at the same place would make the order of their texts ambiguous.
    if (previous !== undefined && (edit.start < previous.end || edit.start === previous.start)) {
      throw new Error(`edits ${previous.start}-${previous.end} and ${edit.start}-${edit.end} overlap`);
    }
  });
  return sorted;
}

/** The text after applying all edits. Offsets refer to the original text. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let result = "";
  let position = 0;
  for (const edit of sortedEdits(text, edits)) {
    result += text.slice(position, edit.start) + edit.newText;
    position = edit.end;
  }
  return result + text.slice(position);
}

/** True when every edit only inserts text: nothing in the original is removed or replaced. */
export function isInsertOnly(edits: readonly TextEdit[]): boolean {
  return edits.every((edit) => edit.start === edit.end);
}

/** Where each line starts (offsets), like a line index. Line endings are \n or \r\n. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** 0-based line that contains `offset`. */
function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Splits text into lines without their line endings. A final line ending does not start a new line. */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

/** One changed block: old lines [oldStart, oldStart + oldCount) become `newLines`. */
interface Change {
  oldStart: number; // 0-based
  oldCount: number;
  newLines: string[];
}

/** The changed blocks of lines that the edits cause, top to bottom. */
function changesOf(text: string, edits: TextEdit[]): Change[] {
  const starts = lineStarts(text);
  const lineEnd = (line: number) => (line + 1 < starts.length ? starts[line + 1] : text.length);

  // Edits that touch the same line belong to one change.
  const groups: TextEdit[][] = [];
  for (const edit of edits) {
    const group = groups[groups.length - 1];
    if (group !== undefined && lineOf(starts, edit.start) <= lineOf(starts, group[group.length - 1].end)) group.push(edit);
    else groups.push([edit]);
  }

  const changes: Change[] = [];
  for (const group of groups) {
    const firstLine = lineOf(starts, group[0].start);
    const lastLine = lineOf(starts, group[group.length - 1].end);
    const segmentStart = starts[firstLine];
    const segment = text.slice(segmentStart, lineEnd(lastLine));
    const shifted = group.map((edit) => ({ ...edit, start: edit.start - segmentStart, end: edit.end - segmentStart }));
    const oldLines = splitLines(segment);
    const newLines = splitLines(applyEdits(segment, shifted));
    // Lines that are the same at the start and the end of the segment are context, not changes.
    let same = 0;
    while (same < oldLines.length && same < newLines.length && oldLines[same] === newLines[same]) same++;
    let sameAtEnd = 0;
    while (
      sameAtEnd < oldLines.length - same &&
      sameAtEnd < newLines.length - same &&
      oldLines[oldLines.length - 1 - sameAtEnd] === newLines[newLines.length - 1 - sameAtEnd]
    ) {
      sameAtEnd++;
    }
    const oldCount = oldLines.length - same - sameAtEnd;
    const added = newLines.slice(same, newLines.length - sameAtEnd);
    if (oldCount > 0 || added.length > 0) changes.push({ oldStart: firstLine + same, oldCount, newLines: added });
  }
  return changes;
}

/**
 * A unified diff of `edits` applied to `text`, with 3 lines of context, or "" when nothing changes.
 * `filePath` is shown as `a/<path>` and `b/<path>`. Line endings are shown as plain new lines
 * (\r is dropped), so the diff is for reading; the edits themselves are the exact change.
 */
export function unifiedDiff(filePath: string, text: string, edits: readonly TextEdit[]): string {
  const changes = changesOf(text, sortedEdits(text, edits));
  if (changes.length === 0) return "";
  const oldLines = splitLines(text);

  // Changes whose context would touch or overlap are shown in one hunk.
  const hunks: Change[][] = [];
  for (const change of changes) {
    const hunk = hunks[hunks.length - 1];
    const last = hunk?.[hunk.length - 1];
    if (last !== undefined && change.oldStart - (last.oldStart + last.oldCount) <= 2 * CONTEXT_LINES) hunk.push(change);
    else hunks.push([change]);
  }

  const out = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let shift = 0; // how many more lines the new file has than the old one, before the current hunk
  for (const hunk of hunks) {
    const first = hunk[0];
    const last = hunk[hunk.length - 1];
    const from = Math.max(0, first.oldStart - CONTEXT_LINES);
    const to = Math.min(oldLines.length, last.oldStart + last.oldCount + CONTEXT_LINES);
    const body: string[] = [];
    let line = from;
    let added = 0;
    for (const change of hunk) {
      for (; line < change.oldStart; line++) body.push(` ${oldLines[line]}`);
      for (let i = 0; i < change.oldCount; i++, line++) body.push(`-${oldLines[line]}`);
      for (const newLine of change.newLines) body.push(`+${newLine}`);
      added += change.newLines.length - change.oldCount;
    }
    for (; line < to; line++) body.push(` ${oldLines[line]}`);

    const oldCount = to - from;
    const newCount = oldCount + added;
    // A hunk with no lines on one side names the line BEFORE it (unified diff convention).
    const oldStart = oldCount === 0 ? from : from + 1;
    const newStart = newCount === 0 ? from + shift : from + shift + 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
    shift += added;
  }
  return out.join("\n") + "\n";
}
