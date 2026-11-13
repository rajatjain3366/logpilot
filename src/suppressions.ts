// Suppressions: comments that hide one finding, with a required reason.
//
//   // logpilot-ignore-next-line LP001 -- the cache is optional; a miss is normal
//   } catch {}
//
//   } catch {} // logpilot-ignore-line LP001 -- the cache is optional; a miss is normal
//
// Block comments work too (`/* ... */`, also `{/* ... */}` in JSX). Several rules can be listed:
// `LP001, LP002`. There is no "ignore everything" form. A suppression that cannot be applied
// (no rule, unknown rule, no reason) or that matches no finding produces a warning, so silent
// decisions do not pile up unnoticed; except "matches no finding" for a rule that is turned off,
// which could not have matched anything. Warnings never change the exit code.

import ts from "typescript";
import { findAllComments } from "./rules/shared.js";
import type { Finding, ScanWarning, SuppressedFinding } from "./types.js";

/** The directive must START the comment, so a comment that merely mentions it is not a suppression. */
const DIRECTIVE = /^\s*logpilot-ignore-(next-line|line)(?=\s|$)([\s\S]*)$/;

interface Suppression {
  commentLine: number; // 1-based line where the comment starts
  targetLine: number; //  the line whose findings it hides
  ruleIds: string[];
  reason: string;
  used: Set<string>; //   rule IDs that hid at least one finding
}

export interface SuppressionResult {
  kept: Finding[];
  suppressed: SuppressedFinding[];
  warnings: ScanWarning[];
}

/**
 * Applies the suppression comments in one file to that file's findings (all with this file's
 * `displayPath`). Returns the findings that stay, the ones that were suppressed, and warnings.
 * `enabledRules` are the rules that ran: a suppression for a rule that is off cannot match
 * anything, so it gets no "matched no finding" warning (it is still checked for mistakes).
 */
export function applySuppressions(
  sourceFile: ts.SourceFile,
  displayPath: string,
  findings: Finding[],
  knownRuleIds: string[],
  enabledRules: ReadonlySet<string> = new Set(knownRuleIds),
): SuppressionResult {
  if (!sourceFile.text.includes("logpilot-ignore")) {
    return { kept: findings, suppressed: [], warnings: [] }; // fast path: most files have none
  }

  const warnings: ScanWarning[] = [];
  const warn = (type: ScanWarning["type"], line: number, message: string) =>
    warnings.push({ type, file: displayPath, line, message: `${displayPath}:${line}: ${message}` });

  const suppressions: Suppression[] = [];
  for (const comment of findAllComments(sourceFile)) {
    const raw = sourceFile.text.slice(comment.pos, comment.end);
    const body = raw.startsWith("//") ? raw.slice(2) : raw.slice(2, raw.endsWith("*/") ? -2 : undefined);
    const match = DIRECTIVE.exec(body);
    if (!match) continue;

    const commentLine = lineOf(sourceFile, comment.pos);
    const dashes = match[2].indexOf("--");
    const idsText = dashes === -1 ? match[2] : match[2].slice(0, dashes);
    const reason = dashes === -1 ? "" : match[2].slice(dashes + 2).replace(/\s+/g, " ").trim();
    const named = idsText.split(/[\s,]+/).filter((id) => id !== "");

    if (named.length === 0) {
      warn(
        "invalid-suppression",
        commentLine,
        'this suppression names no rule; write for example "logpilot-ignore-next-line LP001 -- why" (it was not applied)',
      );
      continue;
    }
    for (const unknown of named.filter((id) => !knownRuleIds.includes(id))) {
      warn("invalid-suppression", commentLine, `unknown rule "${unknown}" in a suppression (known rules: ${knownRuleIds.join(", ")})`);
    }
    const ruleIds = named.filter((id) => knownRuleIds.includes(id));
    if (ruleIds.length === 0) continue;
    if (reason === "") {
      warn("invalid-suppression", commentLine, 'this suppression has no reason; add "-- why" after the rule ID (it was not applied)');
      continue;
    }

    // "next-line" hides findings on the line after the comment (after its last line, for a block comment).
    const targetLine = match[1] === "next-line" ? lineOf(sourceFile, comment.end) + 1 : commentLine;
    suppressions.push({ commentLine, targetLine, ruleIds, reason, used: new Set() });
  }

  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  for (const finding of findings) {
    const suppression = suppressions.find((s) => s.targetLine === finding.line && s.ruleIds.includes(finding.ruleId));
    if (suppression) {
      suppression.used.add(finding.ruleId);
      suppressed.push({ finding, reason: suppression.reason, commentLine: suppression.commentLine });
    } else {
      kept.push(finding);
    }
  }

  for (const suppression of suppressions) {
    for (const ruleId of suppression.ruleIds.filter((id) => !suppression.used.has(id) && enabledRules.has(id))) {
      warn(
        "unused-suppression",
        suppression.commentLine,
        `the suppression for ${ruleId} matched no finding on line ${suppression.targetLine}; remove it if it is no longer needed`,
      );
    }
  }
  return { kept, suppressed, warnings };
}

/** 1-based line number of a position in the file. */
function lineOf(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}
