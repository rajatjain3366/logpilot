# LogPilot handoff (2026-11-25)

For whoever continues this project (a person or an AI assistant). Read CLAUDE.md first: its
"How to work with me" rules still apply (propose and wait, one milestone at a time, real outputs
only, every rule tested on bad and good code, never commit or push without the owner's request).

## Current state

- **Released: v0.5.0** (`logpilot scan`, `logpilot fix`). `package.json` still says 0.5.0.
- **On `main`, unreleased: Milestone T, "Trust and hardening", heading for v0.6.0.**
  - **T1 done** (committed, CI green on all 4 jobs): proven-only defaults, trust contract in the
    README ("What you can rely on"), guarantee tests (`test/guarantees.test.ts`), Wilson intervals.
  - **T2 done** (at the time of writing, uncommitted; see "Commit" at the end): clearer first
    summary line, per-test time limits, the 100-repository robustness run, and the fix it found
    (a file too deeply nested for the parser no longer stops the scan).
  - **T3 and T4 pending** (below).
- Rule work is frozen until Milestone T is finished (owner's decision: "quality and trust over
  features").

## Decisions and their reasons

| Decision | Reason |
|---|---|
| **Default = proven only.** Rule settings `"proven"` (default), `"on"`, `"off"`; `--enable <rule>` = `"on"`. Hidden findings are counted in the summary and never fail `--fail-on`. | Users must be able to trust what is shown by default. |
| **Gate: a rule's severity is shown by default only if held-out precision is 70% or more** (the measured value). Today only **LP003 high** passes (30/33, 91%). LP001, LP002 and LP003 low (4xx) are hidden. | Precision measured on code the rule was not designed on is the only honest number. |
| **Every published precision has n and a 95% Wilson interval** (`wilson()` in `docs/eval-data/scripts/lib.mjs`). E.g. 30/33 → CI 76–97%. Without App P (the dominant app): **13/15** (87%; CI 62–96%). Not 13/16: that was a calculation mistake, corrected from the label files. | Small samples; the interval says how wide the uncertainty is. |
| **Re-promotion rule:** a hidden rule or severity becomes "proven" only after a **new** held-out measurement (new apps, selection protocol hashed before the scan) passes the gate. Re-labelling old findings does not count. A proven level whose new measurement falls below 70% is hidden from the next release on. | Defaults follow evidence in both directions. |
| **JSON schema 4** (v0.6.0): `config.rules` can hold `"proven"`; added `setting`, `provenLevels`, `summary.hiddenNotProvenTotal`, `summary.hiddenNotProven` (right after `findings`), warning type `too-deeply-nested`, `summary.filesTooDeeplyNested`. | Schema policy: changed values = new version; added keys alone do not. |
| **Version 0.6.0 is set at the end of T4**, not before. | Owner's decision. |
| **Next rule after Milestone T: LP006 "weak failure context"**, then **LP004** (unprotected async Express 4 handlers). LP006 ships only if it passes the same gate. | Prevalence study (Nov 2026): text-only error logging was the most widespread gap; no linter covers it. |
| **Deferred, do not start without the owner:** unsafe logging (secrets in logs), LP005 (missing error middleware: Express's default handler already logs the stack), Next.js support for LP003, a website. Also: an axios-safe LP003 fix (log only message/code/status/stack, never `err.config`), keeping LP001's "swallowed test assertion" case on by default, lower LP003 severity in test helpers, placing middleware fixes inside the 5xx branch, an "a = accept all in this file" answer for `fix`. | Recorded ideas, not approved work. |
| **`logpilot fix` (v0.5.0 decisions, do not re-open):** no `--yes`, refuses when not a terminal; no `--allow-dirty` (file must be tracked and clean, and git must be able to restore it byte for byte); no test command; undo is git only; one atomic write per file; the original is restored only if LogPilot's own bytes fail the check. | Every change must be reversible and approved. |

**LP006 design (recommended in the prevalence study; write its proposal before any code):**
report a `catch` that logs only the error's text (`err.message`, `String(err)`, `` `${err}` ``) or
only a constant, and does not pass the error on (no rethrow, `next(err)` or return), in application
code. Must **not** report: deliberate redaction (with a comment or a `redact`/`safe…` helper),
best-effort cleanup, `cond ? err.code : err` (whole error in one branch), a call to the project's
own function with the error. Fix: insertion-only, log the whole error object (same safety checks
as LP003 fixes, never secrets). Counts behind it (30 repos, counting only): 30 text-only catches in
application code in 12 of 30 repositories; 13 constant-only in 9. The prevalence repositories must
never be used for tuning or held-out measurement.

## Next steps

### T3: fix-safety run (same 100 repositories, pinned SHAs in `D:/logpilot-eval/robustness/selected.json`)

1. Write `D:/logpilot-eval/robustness/fix-safety-protocol.md`, hash it before running.
2. For each repository: a fresh `git clone` at the pinned SHA, with this machine's normal git
   settings (`core.autocrlf=true`; add `-c core.longpaths=true`). Fingerprint every file first.
3. Apply **every** offered fix through `runFix` with scripted `y` answers (run B offered 182).
   Report refusals by reason.
4. **Pass (100% of applied fixes):** every changed file parses; `node --check` gives the same result
   before and after for `.js/.cjs/.mjs`; at the character level the old text is the new text with
   characters only added; a re-scan with all rules on has LP003 fewer by exactly the number applied
   and nothing else changed; no stray files; originals untouched; no repository code run.
5. Any failure: root cause, fix, regression test with a made-up reproduction, rerun the whole part.
6. **At the end of T3, delete the clones** (`D:/logpilot-eval/robustness/repos/`, about 9 GB). Keep
   protocols, hashes, candidate lists, `selected.json`, logs and scripts.

### T4: install hardening, limitations, release

1. New CI job "package": `npm pack`; the `.tgz` contains `dist/`, README, LICENSE, no tests or
   fixtures. Install into an empty folder on **Ubuntu, Windows, macOS × Node 22 and 24**; check
   `npx logpilot --version`/`--help`, a scan of a small sample, `fix` refusing piped input (exit 2),
   the messages for a wrong path, `fix` outside git, an unknown option. One **Node 20** job checks the
   "unsupported Node version" message (exit 2).
2. On Linux and macOS, drive the real interactive `fix` through a pseudo-terminal (`script`
   command). Windows stays covered by the owner's manual checks.
3. One complete "Known limitations" list in the README: what each rule misses; small samples;
   default scan covers only Express code (LP003 high); Flow syntax is not parsed (6,726 files with
   syntax errors in 12 of 100 repositories in T2); `fix` limits (LP003 only, needs a terminal, never
   runs tests, refuses dirty files and, with autocrlf, files git would change; Windows ACL/owner);
   one import deep across files; no runtime behaviour measured; Windows interactive `fix` manual only.
4. **Milestone pass/fail:** every guarantee links to a passing test, every number to its
   measurement; defaults exactly as above; robustness 0 crashes/hangs, 100% identical, 0 validation
   failures (done in T2); fix safety 100%; every install matrix cell green. A guarantee that cannot be
   met is moved to "Measured", not claimed. Then set version 0.6.0 and update the README banner.

## How to run things (from `D:/logpilot`)

```bash
npm ci && npm test                                     # typecheck, build, all tests
node dist/cli.js scan . --fail-on low                  # self-scan: must give 0 findings
node docs/eval-data/scripts/check-doc.mjs              # evaluation.md against the label files and hashes
node docs/eval-data/scripts/precision.mjs              # recompute every precision with its Wilson CI
node docs/eval-data/scripts/second-labeller-compare.mjs
```

Robustness run (private): `cd D:/logpilot-eval/robustness && node run.mjs <label>` (after
`npm run build` in D:/logpilot); `search.mjs` and `select.mjs` were run once and must not be rerun
(their outputs are hashed).

## Private data: never commit, never publish

- `D:/logpilot-eval/` holds every private evaluation file: clones, the App A–T mapping
  (`reports/app-id-mapping.json`), labels before anonymization, prevalence and robustness runs.
  Only anonymized counts go into `docs/evaluation.md`.
- `D:/LogPilOt-dev` is a private read-only archive of the old history: never touch or push it.
- Excluded from all future samples: every owner of an earlier sample (built by
  `D:/logpilot-eval/robustness/select.mjs`), plus the 100 robustness repositories.

## Windows lessons

- **Git Bash aliases `node` to `winpty node.exe`.** There, `node ... > file` fails ("stdout is not a
  tty"); use `node.exe` or `--output`. In mintty, `node.exe` sees a real terminal.
- **`core.autocrlf=true`** on this machine: a checked-out file may differ from git's blob, so `fix`
  only changes files git can restore byte for byte (`git cat-file --filters`).
- **`NoDefaultCurrentDirectoryInExePath`:** without it (the owner's Git Bash), Windows runs a
  program from the *current folder* before PATH. LogPilot runs git by absolute path. Test with
  `env -u NoDefaultCurrentDirectoryInExePath npx vitest run` too.
- **8.3 short paths:** GitHub's Windows runners give TEMP as `C:\Users\RUNNER~1\...`; compare paths
  only after `realpathSync.native`. Locally, also run the suite with TEMP/TMP set to a short path.
- **Long paths:** use `git -c core.longpaths=true` for clones *and* for `git status`.
- **Defender:** real-time scanning is on. The first read of freshly created files is very slow
  (webpack clone: 254 s cold, 10 s warm, without LogPilot). This is the likely cause of a one-off
  slow test run; tests now start programs through `test/run-limited.ts` (60 s limit, clear error) and
  Vitest stops tests after 30 s. If slow tests return, find the cause before continuing.
- **Shell habits:** run npm and Vitest from `/D/logpilot` (an uppercase drive letter; `d:` makes
  Vitest load twice). Edit code containing quotes with an editor, not `sed` or `node -e`.
