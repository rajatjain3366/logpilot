// Tests for the helpers in src/rules/shared.ts that more than one rule uses.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { containsComment, findComments, getCatchVariableName } from "../src/rules/shared.js";

/** Parses `code` and returns the first catch clause in it, plus the parsed file. */
function firstCatch(code: string, fileName = "a.ts") {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  let found: ts.CatchClause | undefined;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isCatchClause(node)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`no catch clause in: ${code}`);
  return { catchClause: found, sourceFile };
}

function hasComment(code: string, fileName?: string): boolean {
  const { catchClause, sourceFile } = firstCatch(code, fileName);
  return containsComment(catchClause.block, sourceFile);
}

describe("getCatchVariableName", () => {
  it("returns the name of a plain catch variable", () => {
    expect(getCatchVariableName(firstCatch("try {} catch (parseError) {}").catchClause)).toBe("parseError");
  });

  it("returns undefined when there is no variable or the error is unpacked", () => {
    expect(getCatchVariableName(firstCatch("try {} catch {}").catchClause)).toBeUndefined();
    expect(getCatchVariableName(firstCatch("try {} catch ({ message }) {}").catchClause)).toBeUndefined();
  });
});

describe("containsComment", () => {
  it.each([
    ["an empty block with a line comment", "try {} catch (e) { // ignore\n}"],
    ["an empty block with a block comment", "try {} catch (e) { /* already closed */ }"],
    ["a comment above a statement", "try {} catch (e) {\n  // retry once\n  retry();\n}"],
    ["a comment at the end of the last line", "try {} catch (e) {\n  retry(); // once\n}"],
    ["a comment inside a call's arguments", 'try {} catch (e) { throw new Error("x" /* why */); }'],
    ["a JSX comment", "function C() { try {} catch (e) { return <p>{/* hidden */}</p>; } }", "a.tsx"],
  ])("finds %s", (_label, code, fileName?: string) => {
    expect(hasComment(code, fileName)).toBe(true);
  });

  it.each([
    ["an empty block", "try {} catch (e) {}"],
    ["a block with code only", "try {} catch (e) { retry(); }"],
    ['"//" inside a string', 'try {} catch (e) { fetch("http://example.com"); }'],
    ['"//" inside a template literal', "try {} catch (e) { fetch(`http://${host}/x`); }"],
    ['"/*" inside a regular expression', "try {} catch (e) { const re = /[/*]/; }"],
    ["division", "try {} catch (e) { const half = total / 2 / count; }"],
    ['"//" inside JSX text', "function C() { try {} catch (e) { return <p>see http://example.com</p>; } }", "a.tsx"],
    ["a comment BEFORE the block's {", "try {} catch (e) /* outside */ { retry(); }"],
  ])("ignores %s", (_label, code, fileName?: string) => {
    expect(hasComment(code, fileName)).toBe(false);
  });
});

describe("findComments", () => {
  it("returns the exact position of each comment, and none from strings", () => {
    const code = 'try {} catch (e) {\n  // first\n  f("// not a comment", /* second */ 2);\n}';
    const { catchClause, sourceFile } = firstCatch(code);
    const texts = findComments(catchClause.block, sourceFile).map((c) => code.slice(c.pos, c.end));

    expect(texts).toEqual(["// first", "/* second */"]);
  });
});
