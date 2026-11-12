# LogPilot — Instructions for Claude

## What LogPilot is
An open-source diagnostic-readiness auditor and assisted fixer for JavaScript/TypeScript (Node.js) projects.
Guiding question: "If this code fails in production, does it preserve enough safe, actionable information to investigate the failure?"
Long-term workflow: Scan → Detect → Explain → Propose Fix → Get Approval → Apply Fix → Validate.
Initial command: `npx logpilot scan .`

## Product principles (never violate)
1. Local CLI scanner first. No uploads, no account, no network needed to scan.
2. A normal scan NEVER modifies source files.
3. Accurate, explainable findings > many weak warnings.
4. A missing console.log is NOT automatically a diagnostic gap.
5. Account for existing error handlers, logging libraries (pino, winston, etc.), middleware, tracing.
6. Never suggest logging secrets, tokens, credentials, payment data, or unnecessary personal data.
7. No source-code changes without my explicit approval.
8. Show diffs and validate fixes before reporting success.
9. AI is optional. Core static analysis works with no API key.
10. No microservices, Kubernetes, databases, or hosted infra in the MVP.

## Finding data model (target)
Each finding has: ruleId, file, line, column, severity, confidence (kept separate from severity),
evidence (code snippet), explanation, suggestion.

## Initial rule families (candidates, add ONE at a time)
- Swallowed exceptions (empty/ignoring catch blocks)
- Lost error causes (new Error without { cause })
- Weak failure context
- Unhandled async failures (floating promises, .then without .catch)
- Unsafe logging (secrets in log calls)
- Duplicate error logging

## Roadmap
1. CLI scanner + a few tested rules  ✓ done
2. Structured findings, JSON output, config, suppressions  ✓ done
3. Suggested fixes + diff previews  ← CURRENT
4. Approval-based patch application + validation
5. GitHub Actions / PR integration
6. Optional AI explanations and fix proposals
7. Web dashboard (only if CLI proves useful)
8. More languages / observability integrations (only on demand)

## Tech direction
Node.js (LTS), TypeScript, TypeScript Compiler API (or justified alternative), npm, Vitest, Git/GitHub.
Use stable, compatible dependency versions. Explain WHY before adding any dependency.

## How to work with me
- Use simple English, and explain each new concept the first time it appears.
- One milestone at a time. Do not build ahead.
- Before substantial code: propose, explain, and WAIT for my approval.
- Explain what each file and major function does.
- Give exact terminal commands AND the directory to run them in.
- Keep code simple; no unnecessary abstractions or design patterns.
- Every detection rule gets tests for BOTH problematic code AND correct code that must NOT trigger.
- Never claim a command, test, or feature works unless you actually ran it and saw it pass. Show me the output.
- Never rewrite unrelated files or replace the whole project without a clear stated reason.
- When I share an error, diagnose the root cause first, then propose a fix.
- Keep README.md and docs updated as the code changes.
- Do not commit or push unless I ask.
- End every milestone with: ✅ Completed work, 🧪 Tests run (with results), ⚠️ Remaining issues/limitations, ➡️ Next step.