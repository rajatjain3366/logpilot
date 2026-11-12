# Contributing to LogPilot

Thank you for your interest. LogPilot is small and early, so the most useful contributions are:

- **reports of false positives and missed problems**, with a minimal code snippet (use the
  [issue templates](https://github.com/rajatjain3366/logpilot/issues/new/choose));
- **bug reports** (a crash, a wrong exit code, a confusing message);
- **small, focused pull requests** that come with tests.

Before writing a lot of code, please open an issue first, so we can agree on the approach.

## Ground rules

These come from LogPilot's [principles](README.md#principles) and apply to every change:

- A scan **never modifies** the files it scans, and needs **no network**.
- Suggestions **never** tell users to log secrets, tokens, credentials, payment data or
  unnecessary personal data.
- A few accurate, well-explained findings are better than many weak warnings.
- No new dependency without a short explanation of why it is needed.

## Development setup

Requires **Node.js 22.20 or newer** (on Node 24: **24.8 or newer**).

```bash
git clone https://github.com/rajatjain3366/logpilot.git
cd logpilot
npm ci              # install the exact dependency versions from package-lock.json
npm run typecheck   # type-check src/ and test/ (writes no files)
npm run build       # compile src/ to dist/
npm test            # type-check, build, then run all tests (Vitest)
```

Run a scan from your build with `node dist/cli.js scan <path>`.

`tsconfig.json` is the main TypeScript config (type-checking and your editor);
`tsconfig.build.json` extends it and compiles only `src/` into `dist/`.
`vitest.config.ts` makes Vitest run only `test/*.test.ts`: the files in `test/fixtures/` are
sample input for the scanner (some are even named `*.spec.ts`) and must never run as tests.

Continuous integration ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs `npm ci` and
`npm test` on every push to `main` and every pull request, on Node 22 and 24, on Ubuntu and
Windows.

If `npm test` fails on Windows with "Vitest failed to find the runner", see
[Troubleshooting](README.md#troubleshooting).

## Project layout

```text
src/
  cli.ts                           command-line entry point: arguments, output, exit codes
  config.ts                        finds, reads and checks logpilot.config.json
  file-selection.ts                which folders and files are skipped, and why
  node-version.ts                  the supported Node.js versions
  scanner.ts                       finds files, parses them into syntax trees, runs the rules
  suppressions.ts                  logpilot-ignore comments: which findings they hide, and warnings
  severity.ts                      severity levels, --min-severity and --fail-on checks
  report.ts                        formats findings as readable text
  report-json.ts                   the JSON report (--format json, schema version 1)
  types.ts                         shared data types (findings, skipped paths, warnings)
  rules/shared.ts                  helpers used by several rules (catch variable, comments, evidence)
  rules/lp001-empty-catch.ts       rule LP001
  rules/lp002-lost-error-cause.ts  rule LP002
  rules/express.ts                 recognises Express handlers and error middleware (used by LP003)
  rules/lp003-unlogged-error-response.ts  rule LP003
test/
  lp001-empty-catch.test.ts        rule tests for LP001
  lp002-lost-error-cause.test.ts   rule tests for LP002
  express.test.ts                  Express handler recognition
  lp003-unlogged-error-response.test.ts  rule tests for LP003
  shared.test.ts                   tests for the shared helpers
  config.test.ts                   config file discovery (repository root) and validation
  file-selection.test.ts           default excludes, minified/vendored detection, exclude patterns
  scanner.test.ts                  file discovery, skipped folders and files, syntax warnings, finding order
  suppressions.test.ts             suppression comments: applied, invalid and unused
  severity.test.ts                 severity order and the --min-severity / --fail-on check
  report.test.ts                   text report format
  report-json.test.ts              JSON report shape, counts and ordering
  cli.test.ts                      end-to-end tests of the built CLI, incl. "scan changes no files"
  fixtures/positive/               code that MUST be reported
  fixtures/edge/                   tricky code: reported, often with lower severity or confidence
  fixtures/negative/               code that NO rule may report
docs/
  evaluation.md                    measured precision on real projects, with every labelled finding
  eval-data/                       labels, sealed files, protocols and scripts behind evaluation.md
  early-tester-guide.md            instructions for early testers trying LogPilot on their own projects
```

## Tests

- **Every rule has tests for both problematic code and correct code that must not be reported.**
  Add a fixture to `test/fixtures/positive/` (must be reported), `test/fixtures/edge/` (tricky
  cases, often reported with lower severity or confidence) or `test/fixtures/negative/` (no rule
  may report it). Each rule's tests run it over every file in `fixtures/negative/`.
- The end-to-end test in `test/cli.test.ts` checks that a scan creates, deletes or changes no
  file. Keep it passing.
- If you change `docs/evaluation.md` or anything in `docs/eval-data/`, also run the cross-check
  scripts (they need no `npm install`):

  ```bash
  node docs/eval-data/scripts/check-doc.mjs
  node docs/eval-data/scripts/precision.mjs
  node docs/eval-data/scripts/second-labeller-compare.mjs
  ```

## Proposing a new rule

New rules are added one at a time, and only when they can be shown to find real problems. The path
for a rule is:

1. **Proposal (an issue).** Describe:
   - the code pattern, with a short example;
   - what evidence a failure investigation loses because of it;
   - how it differs from existing lint rules (ESLint, typescript-eslint, eslint-plugin-sonarjs,
     Biome; see [How LogPilot relates to ESLint](README.md#how-logpilot-relates-to-eslint));
   - the cases that look similar but are fine, and must **not** be reported.

   Wait for agreement before writing code.
2. **Fixtures, including negative cases.** Write the positive, edge and negative fixtures first.
   The negative cases matter as much as the positive ones: they are what keeps the rule quiet on
   correct code.
3. **Implementation and tests.** Give each finding a severity and a separate confidence, an
   explanation of what is lost, and a suggestion that never involves logging secrets or personal
   data.
4. **Measurement on unseen code.** Before the rule is released, run it on real projects that played
   no part in designing it (held-out projects), chosen by a selection method written down before
   looking, and label every finding as a real problem, debatable, or not a problem. The precision is
   published in [docs/evaluation.md](docs/evaluation.md), whatever it is. Projects used to tune
   the rule do not count towards its precision.

## Pull requests

- Keep each pull request to one change, with tests.
- Run `npm test` before opening it.
- Update `README.md` (and `docs/` where relevant) when behaviour or output changes.
- Never include real secrets, tokens or private code in issues, pull requests, fixtures or test
  output. Use made-up values.

## Security

Please do **not** report vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).
