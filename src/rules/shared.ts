// Helpers used by more than one rule. They only read the syntax tree; nothing here touches the disk.

import ts from "typescript";

/** Evidence is cut off after this many lines so the report stays readable. */
const MAX_EVIDENCE_LINES = 5;

/**
 * The catch's variable name, e.g. "parseError" for `catch (parseError)`.
 * undefined for `catch {}` (no variable) and `catch ({ message })` (the error is unpacked),
 * because then no single name holds the whole error.
 */
export function getCatchVariableName(catchClause: ts.CatchClause): string | undefined {
  const binding = catchClause.variableDeclaration?.name;
  return binding && ts.isIdentifier(binding) ? binding.text : undefined;
}

/** A `// line` or `/* block *\/` comment. An unfinished block comment runs to the end of the text. */
const COMMENT_PATTERN = /\/\/[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

/**
 * Every comment between a block's `{` and `}`, as positions in the file (`pos` up to `end`).
 *
 * Comments are not nodes in the syntax tree. They are "trivia" (like spaces and newlines)
 * that sit in the gaps between tokens. So we walk the tree and look only at the text that
 * is NOT inside a token: the gaps hold just whitespace, comments and punctuation such as
 * `(`, `;` or `}`, so a "//" or "/*" there must start a comment. A "//" inside a string,
 * template, regular expression or JSX text belongs to a token and is correctly ignored.
 */
export function findComments(block: ts.Block, sourceFile: ts.SourceFile): ts.TextRange[] {
  // Start at the `{` itself, so a comment written before the block (`catch (e) /* x */ {`) is not counted.
  return collectComments(block, block.getStart(sourceFile), sourceFile);
}

/** Every comment in a whole file, found the same way as `findComments` (never inside strings). */
export function findAllComments(sourceFile: ts.SourceFile): ts.TextRange[] {
  return collectComments(sourceFile, 0, sourceFile);
}

/** The comments in the text of `root`, from `rootStart` to its end. */
function collectComments(root: ts.Node, rootStart: number, sourceFile: ts.SourceFile): ts.TextRange[] {
  const text = sourceFile.text;
  const comments: ts.TextRange[] = [];
  const collectBetween = (from: number, to: number): void => {
    if (to <= from) return;
    for (const match of text.slice(from, to).matchAll(COMMENT_PATTERN)) {
      comments.push({ pos: from + match.index, end: from + match.index + match[0].length });
    }
  };

  // Collects comments in the text of `node` from `start` to its end, skipping the text of its tokens.
  function visit(node: ts.Node, start: number): void {
    if (ts.isToken(node)) {
      // An identifier, string, number, regex, template piece or JSX text: only the
      // whitespace/comments in front of it count, never its own text (e.g. "http://...").
      collectBetween(start, node.getStart(sourceFile));
      return;
    }
    let position = start; // everything before `position` has been looked at
    ts.forEachChild(node, (child) => {
      collectBetween(position, child.pos);
      visit(child, child.pos);
      position = child.end;
    });
    collectBetween(position, node.end);
  }

  visit(root, rootStart);
  return comments;
}

/** True when there is a comment between a block's `{` and `}`. */
export function containsComment(block: ts.Block, sourceFile: ts.SourceFile): boolean {
  return findComments(block, sourceFile).length > 0;
}

/**
 * Every place inside `nodes` that refers to the variable `name`.
 * `state.err` and `{ err: 1 }` contain the word but not the variable, so they are skipped.
 */
export function findMentions(nodes: readonly ts.Node[], name: string): ts.Identifier[] {
  const mentions: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && !isPropertyName(node)) mentions.push(node);
    ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return mentions;
}

/** True for the `b` in `a.b` and the key in `{ b: 1 }`: a name that is not a variable. */
export function isPropertyName(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === identifier;
}

/** (x), x as T, x!, <T>x and x satisfies T all still mean just x. */
export function isWrapper(
  node: ts.Node,
): node is ts.ParenthesizedExpression | ts.AsExpression | ts.NonNullExpression | ts.TypeAssertion | ts.SatisfiesExpression {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

/** Returns the full text of lines firstLine..lastLine (0-based), at most MAX_EVIDENCE_LINES of them. */
export function getLines(sourceFile: ts.SourceFile, firstLine: number, lastLine: number): string {
  const lineStarts = sourceFile.getLineStarts(); // character offset where each line begins
  const text = sourceFile.text;
  const last = Math.min(lastLine, firstLine + MAX_EVIDENCE_LINES - 1);
  const lines: string[] = [];
  for (let i = firstLine; i <= last; i++) {
    const lineEnd = i + 1 < lineStarts.length ? lineStarts[i + 1] : text.length;
    lines.push(text.slice(lineStarts[i], lineEnd).replace(/\r?\n$/, ""));
  }
  return lines.join("\n");
}
