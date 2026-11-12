# LogPilot evaluation

This document records how well LogPilot's findings hold up on real open-source code. The point is
to measure **precision**, the share of findings that are real problems, honestly, and to track
it as the rules change. Three rounds have been measured so far.
[LP003](#current-results-lp003-on-held-out-express-apps) was measured on held-out Express apps in
Milestone 2.5, and 10 of its findings were labelled again by a
[blind second labeller](#lp003-second-labeller-check). [Round 3](#current-results-lp001-v2-round-3-held-out) is the current honest
estimate for LP001 (version 2, frozen); [round 2](#round-2-results-held-out) is still the latest
held-out measurement of LP002; round 1 is kept further down as history. A
[re-scan](#milestone-2-mongodb-driver-re-scan-with-default-excludes-not-a-precision-claim) of the
MongoDB driver after Milestone 2 checks the new default file skips; it is not a new precision
measurement.

[Milestone 3](#milestone-3-lp003-fix-previews-on-the-tuning-apps) checks LP003's fix previews on the
tuning apps; it measures the fixes, not the findings, and is not a precision claim.

**Commit hashes:** the LogPilot commits cited here (`be0126b`, `15f0b46`, `5c9a4a6`, `318499c`, and any other) refer to the private development history; the public repository starts from a single snapshot commit. Exception: `4f741fa`, cited in the Milestone 3 section, is a commit of the public repository.

## Evaluation data and anonymized apps

**Student and beginner apps are anonymized.** 20 small Express/MERN apps were looked at in round 2
and for LP003. They are public repositories, mostly by students and beginners. This document calls
them **App A to App T** and does not link to them:

- **Why:** to avoid publicly labelling students' code.
- **The mapping** to real names, URLs and pinned commits **is kept privately**, outside this
  repository.
- **The mature open-source projects are named and linked as before:** Express, Vite, Mongoose, the
  MongoDB Node.js driver, knex and node-postgres.
- **LP003 pattern IDs use the new letters:** P1 is App P's first pattern.
- **Anonymized does not mean unidentifiable.** File paths and descriptions remain, so a determined
  reader could find an app by searching code. The aim is only not to name and label them.

**The data behind the numbers is published in [eval-data/](eval-data/README.md):**

- label files;
- sealed files;
- selection protocols;
- the second labellers' labels;
- scripts that check this document against them and recompute its numbers.

It contains no scan output and no code from the evaluated projects.

**Hashes published in advance.** Four files were sealed with a SHA-256 published before the step
they guard:

| File | SHA-256 cited in this document | Published as | What a reader can check |
|---|---|---|---|
| Round-2 second-labeller sealed labels | `054b7661…4c35a` | `eval-data/sealed/second-labeller-claude-labels.json`, unchanged | the published file has the cited hash |
| LP003 selection protocol | `e76ff9f4…9b3df` | `eval-data/protocols/lp003-selection-protocol.anon.md` | anonymized copy (see below) |
| LP003 recall classification | `601dd9ce…9e043` | `eval-data/sealed/lp003-recall-classification.anon.json` | anonymized copy |
| LP003 second-labeller sealed labels | `cfdf8870…f91c3` | `eval-data/sealed/lp003-second-labeller-claude-labels.anon.json` | anonymized copy |

**Why three copies are anonymized, and how they differ from the originals.**

- The original files name student apps, so they are not published. They were not edited.
- Each copy differs from its original in one way only: every real repository name is replaced by
  its ID (`owner/name` becomes `App X`, and the folder form `owner__name` becomes `app-x`).
- Replacing the IDs back with the private mapping gives the original bytes, whose SHA-256 is the
  cited hash. This was checked for all three.
- Without the mapping, a reader can check each copy against its own hash, listed in
  [eval-data/hashes.json](eval-data/hashes.json), and run the scripts on it. They cannot check the
  cited hash.

## Second-labeller check

This is the round-2 check (LP001 and LP002 on the MongoDB driver). The LP003 check has its own
section: [LP003 second-labeller check](#lp003-second-labeller-check).

**Status: done.** The project owner labelled the 10 findings below blind, using the definitions
under [Labels](#labels). They are a beginner and asked that their labels be treated as an
independent second opinion, not as the correct answer. So every disagreement was settled by
re-reading the code, not by deferring to either side.

The 10 findings were chosen without looking at labels:

1. **Population:** the 19 held-out findings in the MongoDB driver's own code whose label I had not
   already stated in our conversation.
   - My progress notes had already given my view of all 11 beginner findings and of 11 MongoDB
     findings, so those are left out.
   - Findings in vendored libraries are left out too.
   - The cost: all 10 come from mature code.
2. **Groups:** rule × severity. A group of n findings gets k = max(1, round(10 × n ÷ 19)) picks.
3. **Within a group,** in report order, the picks are the findings at positions ⌊(i + 0.5) × n ÷ k⌋,
   for i = 0 … k−1.
4. **Listed by file path,** so the order hints at nothing.

My labels were sealed before the second labelling in
a file now published unchanged as
[eval-data/sealed/second-labeller-claude-labels.json](eval-data/sealed/second-labeller-claude-labels.json). Its
SHA-256 was published here in advance as
`054b7661286f6a479bc96a41c26dd6d8675b13b88e86fb5cc4f097157dd4c35a`. It was checked again before
the comparison and was unchanged.

### Results

| # | Finding (MongoDB Node.js driver at `a255151`) | Rule | LogPilot level | Claude (sealed) | Second labeller | After re-reading the code |
|---|---|---|---|---|---|---|
| 1 | [src/cmap/auth/scram.ts:252](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/cmap/auth/scram.ts#L252) | LP002 | high/medium | Debatable | FP | Debatable more likely: the FP reason describes the catch block above (see below) |
| 2 | [src/collection.ts:338](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/collection.ts#L338) | LP002 | low/medium | Debatable | FP | **FP more likely**: the second labeller is right |
| 3 | [test/integration/crud/bulk.test.ts:1760](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/bulk.test.ts#L1760) | LP001 | low/medium | FP | FP | agree |
| 4 | [test/integration/node-specific/abort_signal.test.ts:288](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/node-specific/abort_signal.test.ts#L288) | LP001 | low/medium | FP | FP | agree on the label; the second labeller's reason describes the test above |
| 5 | [test/mongodb_bundled.ts:8](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/mongodb_bundled.ts#L8) | LP002 | medium/high | TP | TP | agree |
| 6 | [test/tools/runner/filters/crypt_shared_filter.ts:30](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/runner/filters/crypt_shared_filter.ts#L30) | LP001 | low/medium | FP | Debatable | **Debatable more likely**: the second labeller is right |
| 7 | [test/tools/unified-spec-runner/operations.ts:228](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L228) | LP001 | low/medium | Debatable | FP | Debatable more likely: the try also wraps `close()` |
| 8 | [test/tools/unified-spec-runner/operations.ts:240](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L240) | LP001 | medium/high | Debatable | FP | Debatable more likely: same as #7 |
| 9 | [test/tools/unified-spec-runner/operations.ts:901](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L901) | LP001 | low/medium | FP | FP | agree |
| 10 | [test/unit/client-side-encryption/state_machine.test.ts:886](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/unit/client-side-encryption/state_machine.test.ts#L886) | LP001 | low/medium | FP | FP | agree |

| Measure | Value |
|---|---|
| Agreement on the 3 labels (TP / Debatable / FP) | 5 of 10 |
| Cohen's kappa, 3 labels | **0.09** (chance agreement 0.45) |
| Agreement on TP vs not TP (the only distinction precision uses) | 10 of 10, kappa 1.00 |
| After re-reading: second labeller more likely right | 2 (#2, #6) |
| After re-reading: Claude more likely right | 3 (#1, #7, #8) |

**Cohen's kappa** measures how much two labellers agree beyond what they would agree by chance,
given how often each uses each label. 1 means perfect agreement and 0 means no better than
chance. We agreed 5 times out of 10, but would agree about 4.5 times by chance (the second
labeller chose FP 8 times, Claude 5 times), so kappa is only 0.09. With 10 items it is also very
unstable.

**What the numbers mean.** Every disagreement is between *debatable* and *FP*. We agree
completely on which finding is a real problem (#5) and which are not. Precision counts debatable
and FP alike as "not a true positive", so **none of the disagreements changes any precision
number** in this document. The low kappa says the line between "debatable" and "FP" is not
shared yet: the label guide needs to draw it more clearly.

### The disagreements, side by side

| # | Claude's reasoning (sealed label) | Second labeller's reasoning | Who is more likely right after re-reading, and why |
|---|---|---|---|
| 1 | Debatable: a deliberate, commented translation. In FIPS mode the OpenSSL failure is replaced by a clearer message, but the `if` checks the environment, not the error, and the OpenSSL error is dropped. | FP: "the original error is preserved using `cause: e`; the other catch rethrows the original error." | **Claude.** `{ cause: e }` belongs to a *different* try/catch, lines 231–242 (loading `crypto`). The flagged throw at line 252 is in `catch (err)` at line 248, and it does not attach `err`. `throw err` at line 254 only runs when FIPS is off. LogPilot reported exactly line 252 and not the catch with `cause`, so it read the code correctly: no rule bug. Debatable rather than TP, because the translation is deliberate and explained. |
| 2 | Debatable: translates a recognised validation error into a clearer one; only the internal stack is dropped. | FP: "intentionally translates a known internal validation error into a clearer public-facing argument error." | **Second labeller.** The `if` matches the caught error's *exact message*, so the original error is fully identified and carries no information that the new one lacks. Its stack only points inside the driver's own validation. Claude applied the rule "translation means debatable" too mechanically; this is closer to the "internal signal" case, which is FP. |
| 6 | FP: a test filter detecting an optional library; failing to load means "not available". | Debatable: "tries a fallback configuration, but if both attempts fail, it returns null and loses the failure reasons." | **Second labeller.** There are two attempts, and `null` makes the test runner treat the library as *absent*. A broken install then looks exactly like a missing one: the tests that need the library are skipped, and the reason it failed to load is lost. Claude labelled the shape ("feature detection") without checking the consequence. |
| 7 | Debatable: the runner tries each entity kind in turn, but the try also wraps `close()` itself, so a real close failure ends up reported as "no closable entity". | FP: "wrong entity type is expected while checking whether the requested entity is a cursor." | **Claude.** The wrong-type error is indeed expected; the comment above the function says so. But the same try also runs `await cursor.close(...)`. If `close()` fails, that error is swallowed, the next lookups fail on type, and the final message says "No closable entity with key X", which is false. No current spec test expects `close` to fail, so this only bites on an unexpected failure. That is why it is debatable, not TP. |
| 8 | Debatable: same as #7, for the last attempt. | FP: "wrong entity type is expected while checking whether the requested entity is a stream; the code tries another entity type." | **Claude.** Line 240 is the *client* attempt, the last one (the stream attempt is line 234, not in this sample). A failed `client.close()` goes straight to the misleading "No closable entity" error. |

On #4 both labels are FP, but for different reasons. The second labeller's reason ("the caught error
is stored and checked to be a DOMException") describes the previous test, lines 263–278, whose catch
LogPilot correctly does not report. The flagged catch at line 288 is empty; that test ignores the
expected abort error and checks which commands ran.

**#7, #8 and #9: one idea, two patterns.** All three probe "is this entity of kind X?".

- In `close` (#7, #8: pattern F), the `try` contains the lookup **and the real operation**.
- In `rename` (#9: pattern G), it contains **only the lookup**; `rename()` runs outside the try,
  and a failed match ends in a clear `expect.fail`.

What is inside the try decides what an empty catch can swallow. That is why the same idea gets
different labels.

**Label-guide clarifications this suggests.** These are now part of the labelling guide for future
rounds (see [Labels](#labels)); past labels are unchanged:

1. A translation whose `if` identifies the caught error exactly (an exact message or class) and
   whose new error says at least as much is FP, not debatable.
2. Judge a "feature detection" or "fallback" catch by its consequence: if a failure silently
   changes what runs (for example, which tests run), it is at least debatable.
3. Read the whole try block, not only the line the comment talks about.

**LogPilot observation:** #7 and #8 are the same pattern but got different levels (low vs medium).
The `/* eslint-disable no-empty */` line directly above the first `try` counts as an "explaining
comment". A linter instruction is not an explanation.

## Milestone 3: LP003 fix previews on the tuning apps

**What this measures:** the fixes that `--fix-preview` proposes for LP003 findings, on the seven
apps LP003 was tuned on (App A, B, D, E, F, G, H; held-out apps were not opened). It says whether the
fixes are valid, small and sensible. **It is not a precision claim** (that is about the findings,
measured above), and tuning apps make it optimistic.

**Method, written down before any fix was generated.** The protocol was saved privately (it names
the apps' folders); its SHA-256 is
`686759d393182ebca803f7f845ad08b7c00ce322b5cd78fef19b05a3abf0bf78`, recorded at
2026-11-12T11:21:01Z. In short:

- LogPilot `4f741fa` (public repository, clean working tree), default settings,
  `scan <app> --fix-preview --format json`, once per app.
- Every file of every app (except `.git/`) was fingerprinted (path, size, modification time,
  SHA-256) before the run, after it, and again after the judging. **All three fingerprints are
  identical: LogPilot changed no file.**
- "Minimal" means: one inserted line, one statement inserted in an existing line, or one added
  argument (case C), plus at most the catch variable (` (err)`).
- A systematic sample of 30 fixes (positions ⌊(i + 0.5) × N ÷ 30⌋ in the fixes sorted by app, file
  and line) is judged *correct-looking*, *questionable* or *wrong*, with one line of reasoning
  (placement, logger choice, behaviour unchanged, safe context only), and the judgements are sealed
  before the project owner sees anything.
- The project owner labels 10 fixes blind; see
  [the blind review](#milestone-3-blind-review-of-10-fixes) for how they were drawn.
- Disclosure: before this run, `--fix-preview` had been run on App A and App H to measure its speed
  (counts only; no fix was read).

**Results (automatic, all LP003 findings):**

| | Count |
|---|---|
| LP003 findings | 112 (App A 77, App F 20, App D 6, App E 6, App G 2, App H 1, App B 0) |
| Fix available | **107** |
| No fix: a 4xx answer (case E) | 5 |
| Fix proposed but refused by LogPilot's own checks (a LogPilot bug) | **0** |
| Minimal | **107 of 107**: one inserted line (86), one inserted line plus the catch variable (21) |
| Diff size | +1 line (86); +2 −1, the `catch` line changed to add the variable (21) |
| Logger used | `console.error` for all 107 (confidence low): none of the apps uses a logger LogPilot recognises |
| Note "the error (or its message) is still sent to the client" (case B) | 83 |
| Note "this code still answers 200 OK" (case D) | 2 |
| Case C (error added to an existing console call) | none occurred |

- **The logger detection is not tested by this data:** no tuning app uses pino, winston, bunyan or
  an imported project logger in its server code. It is covered only by the test fixtures.
- **8 of the 107 fixes are in App F's `.server-build/` folder,** compiled copies that the LP003
  tuning round labelled FP. Their fixes are mechanically fine but would be lost on the next build.
  No other per-finding labels exist for the tuning apps, so no TP/FP split of the fixes is given.

**Changed after this measurement (v0.4.1).** Everything above was measured with v0.4.0.

- **Dot-named build folders are skipped by default.** App F's `.server-build/` is no longer scanned,
  so its 8 compiled-copy findings and their fixes are gone: the tuning apps give 104 LP003
  findings and 99 fixes, again with 0 refused by validation.
  - The rule was checked on all 25 evaluated projects using only `--show-skipped` lists, before and
    after implementing it. It newly skips exactly two folders: this `.server-build/`, and App Q's
    `.yarn/`, which holds only Yarn's own `plugins` and `releases`.
  - None of the published held-out findings is inside either folder, so no precision number in
    this document changes.
- **Fixes in code that saves a password-like field get a note** (validation errors can keep the
  failing value; measured with Mongoose 9 during the blind review below).
  - On the tuning apps, 5 of the 99 fixes get it, all in handlers that create or change a password.
  - All 5 handlers already check the password's length before saving, so in that app the note is a
    reminder, not a found leak.

### Milestone 3: judgements of the sample of 30

Claude's 30 judgements were sealed at 2026-11-12T11:42:15Z in a private file whose SHA-256 is
`cee4777b0a1ac45021810948f4c27fd9b5aac66b781edb2fbc1a77ed3761026c`. The file still had that hash at
the comparison.

| Label | Fixes |
|---|---|
| correct-looking | 28 |
| questionable | 2 |
| wrong | 0 |

- **The 2 questionable fixes are App F's compiled copies** (`.server-build/`). Each fix is right in
  itself, but a rebuild overwrites it, and the change belongs in the TypeScript source.
- **The 28 correct-looking fixes** each put one `console.error` line just before the catch's only
  5xx response, in the file's own style, with the real error variable (or a new `err` for
  `catch {}`).
- **A correction to two sealed reasons (the labels do not change).** Two sampled fixes are in
  handlers that save a password. Their sealed reasons say the password cannot appear in the error
  because the model's `minlength` message leaves the value out. Running Mongoose 9 later showed
  that this is not what protects it. The message does leave the value out, but the error *object*
  keeps the failing value (`errors.password.value`), and `console.error` and pino both print it.
  What protects the password in both handlers is that its length is checked before saving, so the
  password field can never fail validation there. This correction was written down privately before
  the blind-review comparison below.

### Milestone 3: blind review of 10 fixes

**The first blind list was withdrawn before anyone labelled it.** It held 10 of the 30 judged
fixes, but Claude's progress notes in the working session had named the headline of the sealed
judgements and two individual ones. The project owner decided to review a fresh 10 instead.

**How the fresh 10 were drawn.**

- A protocol written before the draw (SHA-256
  `b11122dbfa603fc09f562825f7ccb34c67d45d16240c92280156a350367a77f4`, 2026-11-12T15:09:09Z) took the
  77 fixes outside the sample of 30 and left out App F's compiled copies (they had been named).
- It sorted the rest by app, file and line, and took positions ⌊(i + 0.5) × M ÷ 10⌋.
- Claude judged the 10 and sealed the judgements (SHA-256
  `6d110b6064bf40c30177d6f6c765711a7882ee6b62a9c966ce2ec97d2476f2ba`, 2026-11-12T15:11:14Z) before
  writing the list the owner labelled. The hash was checked again before the comparison.
- 8 of the 10 fixes are in App A, 2 in App F's TypeScript source.

| | Claude (sealed) | Project owner (blind) |
|---|---|---|
| correct-looking | 10 | 9 |
| questionable | 0 | 1 (marked "unsure") |
| wrong | 0 | 0 |

| Measure | Value |
|---|---|
| Agreement on the label | 9 of 10 |
| Cohen's kappa | not meaningful: Claude gave every fix the same label, so kappa is 0 whatever the owner does (see the explanation in [LP003 second-labeller check](#lp003-second-labeller-check)) |

**The one disagreement: a handler that creates staff accounts (App A).** The fix adds a
`console.error(..., error)` line before the handler's 500 response.

- **The owner labelled it questionable:** "this handler creates staff accounts and handles
  passwords. Logging the complete error object could potentially expose sensitive values. A redacted
  logger would be safer."
- **Claude had labelled it correct-looking.**

After re-reading the handler and running the libraries it uses (Mongoose 9.12, bcryptjs 3.0, with
the app's user schema copied exactly):

- **The password cannot reach the error object in this handler.**
  - A Mongoose validation error keeps only the values of the fields that failed. When another field
    fails (tested: a missing tenant ID, an unknown role), the password is not in the error. Only a
    failing *password* field puts it there.
  - Here the password cannot fail. A password the admin types is checked to be at least 8
    characters before the account is created. A generated password is 11 characters (2,000,000
    generated, none shorter); only `Math.random()` returning exactly 0 would make a shorter one.
  - bcryptjs's errors name only the types of their arguments (tested).
  - The database only ever receives the bcrypt hash, never the password itself.
- **The e-mail address can reach it.** The handler checks for an existing e-mail first, but two
  requests at the same moment could both pass that check. MongoDB's duplicate-key error then names
  the duplicated e-mail (from MongoDB's documented error format; not run here, as there was no
  database). The handler already sends that same message to the client.
- **So under the written definitions, correct-looking is more likely right for this handler.** The
  owner's concern is still right about the pattern. In a handler that does not check the password
  before saving, the same fix would log the plaintext password whenever it fails validation
  (tested: `console.error` and pino both print it; with Mongoose's default `minlength` message, even
  `error.message` contains it).
- **Proposal from this review (not built):**
  - When the `try` block of an LP003 fix sets a password-like field (for example `password` in
    `User.create({ ... })`, or `user.password = ...`), show the fix with a warning that validation
    errors keep the failing value. The warning recommends checking the value before saving, or
    redacting it in the logger.
  - Not a refusal, unlike axios (whose errors always carry the request's headers). The leak needs the
    password field itself to fail validation, which handlers often rule out (both password handlers
    in the sample of 30 did). Refusing would also remove the log for database failures in exactly the
    flows where they matter most.

**Limits of this check.**

- 10 fixes from two apps, all one shape (`console.error`, one line, before a 5xx response); most
  are App A's repeated controller pattern.
- The owner is a beginner and asked that their labels be treated as a second opinion, not the right
  answer. The disagreement was settled by re-reading the code and running the libraries.
- During the fresh draw, Claude's progress notes said that it was checking whether password handlers
  check the password before saving (the topic of the disputed fix), and that "both password handlers
  check the length before saving, so the result holds" (meaning the two password handlers of the
  first sample). They named no label of the fresh 10. The owner's label on the disputed fix differs
  from Claude's, so that note cannot have produced agreement there.

## Current results: LP003 on held-out Express apps

LP003 (`unlogged-error-response`, version 1) looks for Express handlers and error middleware that
send an error response while the caught error is never logged, passed on or rethrown. Unlike the
earlier rounds, it was evaluated on **Express and MERN apps**, not libraries.

**How the apps were chosen.** A written protocol, `lp003-selection-protocol.md`, was saved before
any search. Its SHA-256 is `e76ff9f4254ed10d68657812821482e6c124085d6bda1f59540d8b3e21b9d3df`,
recorded at 2026-11-10T11:36:01Z. It names the round-2 apps, so it is published as an anonymized
copy: [eval-data/protocols/lp003-selection-protocol.anon.md](eval-data/protocols/lp003-selection-protocol.anon.md).

- Four GitHub searches were run: topics `mern-stack` and `express`, each in JavaScript and
  TypeScript, sorted by most recently updated.
- The results were walked in a fixed order. A repository was accepted if all of these held:
  - not a fork, not archived, and the first repository from its owner;
  - not used before in any evaluation;
  - `express` is listed in some `package.json`;
  - 5 to 300 files that LogPilot would scan;
  - at least one catch with `res.` within 10 lines.
- Accepted repositories went into two size groups: small (5-60 files) and medium (61-300).
- 32 repositories were walked to fill 8 per group.
- The split was decided by the SHA-256 of each repository's name: 2 per group went to tuning, 6 to
  held-out.
- The held-out apps were cloned and pinned, but not scanned until LP003 was frozen.

| Set | Apps |
|---|---|
| Tuning | App E, App F, App G, App H (new); App A, App B, App D (round 2) |
| Held-out | App I, App J, App K, App L, App M, App N (small); App O, App P, App Q, App R, App S, App T (medium) |

**Tuning (numbers optimistic, not a claim).** The first version found 88 findings in the tuning
apps. Looking at what it missed in the tuning apps led to one change: **tuning change 1**.

- Responses sent through a helper defined in the same file, such as `errorResponse(res, 502, "...")`,
  now count, and LP003 looks into the helper to see whether it logs the error.
- Two tuning apps used helpers that log (`fail`, `serverError`). LP003 already treated those
  correctly, and still does.
- After the change: 65 findings were labelled (App A: a systematic sample of 30 of its 77), with
  **50 TP, 7 debatable and 8 FP**.
- The 8 FP are compiled copies in App F's `.server-build/` folder, which the default file skips
  do not recognise.

**Frozen version:** LogPilot commit `318499c` plus the uncommitted LP003 code. The SHA-256 of
`git diff HEAD -- src` starts with `d95a81e57a46cab8`. The SHA-256 over every file in `src/`
(`find src -type f | sort | xargs sha256sum | sha256sum`) starts with `15951ac6e86dd79a`. Both were
recorded at 2026-11-10T12:05:38Z. The held-out apps were then scanned once, at 12:07:17Z. Nothing
was tuned afterwards.

**Held-out results: 43 findings in 11 of the 12 apps (App O had none), all labelled.**

| | Precision (TP / findings) | TP / debatable / FP |
|---|---|---|
| **High severity** | **30/33 (91%)** | 30 / 2 / 1 |
| **Medium severity** (all case E) | **0/10 (0%)** | 0 / 10 / 0 |
| Low severity | no findings | |
| Case A (5xx, error never used) | 21/24 (88%) | 21 / 2 / 1 |
| Case B (error sent to the client only) | 3/3 | 3 / 0 / 0 |
| Case C (log line without the error) | 6/6 | 6 / 0 / 0 |
| Case D (no error status) | no findings | |
| Case E (4xx) | 0/10 (0%) | 0 / 10 / 0 |
| Confidence high (registered in the file) | 17/19 (89%) | 17 / 2 / 0 |
| Confidence medium (shape only, or case D/E) | 13/24 (54%) | 13 / 10 / 1 |
| **All** | **30/43 (70%)** | 30 / 12 / 1 |
| Distinct patterns (TP patterns) | 16 (6) | |

What this shows:

- **The findings at high severity are mostly real problems: 30 of 33.** The 3 that are not are
  two health checks (debatable) and one catch that nothing can reach (FP).
- **Case E (4xx) found no real problem.** All 10 are authentication checks or plugin validation:
  - a 401 or 400 is the right answer to the expected failure;
  - only a mixed-in unexpected failure (a database outage during login) would be lost.

  So they are debatable. They were measured at medium severity. Afterwards, LP003 version 2
  lowered case E to low ([see below](#lp003-second-labeller-check) and the change note after this
  list); that new level is unmeasured.
- **One app dominates.** App P gives 18 findings, 17 of them one repeated pattern (P1). By
  pattern, 6 of 16 are true positives. Treat 70% as an upper estimate of what a new app will see.
- **No error middleware was found in the held-out apps,** so the middleware extension has no
  held-out measurement yet.
- **Recall estimate: 18 of 18.** The protocol picked a systematic sample of 60 of the 174 candidate
  catches; the instances among them were classified by hand before the scan, and LP003 reported all
  of them.
  - The classification's SHA-256 is
    `601dd9cef982d7119d8f98e2099798a31749408e8e6e1df390bae564c879e043`, recorded at 12:07:01Z.
    It is published as an anonymized copy:
    [eval-data/sealed/lp003-recall-classification.anon.json](eval-data/sealed/lp003-recall-classification.anon.json).
    The sampled code itself is not published.
  - LP003 reported none of the candidates classified as not an instance.
  - This only covers catches with a response within 10 lines; it says nothing about responses sent
    through helpers in other files, or promise `.catch()` callbacks. There were no such instances
    in the sample.
- **Second labeller:** a blind check of 10 findings agreed on all 8 at high severity and
  disagreed on both case E findings. No high-severity number changes. See
  [LP003 second-labeller check](#lp003-second-labeller-check).

**Change made after this measurement: LP003 version 2.** After the held-out results and the
second-labeller check below, case E's severity was lowered from *medium* to *low*. Confidence
stays *medium*, and nothing else changed.

- **Why:** all 10 case E findings were debatable. The project owner decided that the label
  definition stays as it is and that no finding is relabelled.
- **What this means for the numbers:** every number in this section was measured with version 1,
  where case E was *medium*. **Case E's new level has not been measured, and no new precision
  is claimed for it.**
- Version 2 would report the same 43 findings, and the 10 case E findings would be *low*
  instead of *medium*. That is a prediction from the code, not a measurement.
- Measuring version 2 needs new held-out apps, because these 12 have now been used to make the
  change.

**Second-labeller check (status: done; results in
[LP003 second-labeller check](#lp003-second-labeller-check)).** The 10 findings below were
picked with the method fixed in the protocol: groups are case × severity, with 6 from A/high,
2 from E/medium, 1 from B/high and 1 from C/high. That method puts 5 of the 10 in App P,
because most high findings are there. Claude's labels for these 10 were sealed in a file whose
SHA-256 is `cfdf8870eafcfeee4126b6b60422d066a430e415941ee8ca31798556673f91c3` (recorded at
12:08:59Z, before any second labelling). It is published as an anonymized copy; see
[Evaluation data and anonymized apps](#evaluation-data-and-anonymized-apps).

1. App P: backend/routes/auth.js:92
2. App P: backend/routes/categories.js:75
3. App P: backend/routes/checkout.js:191
4. App P: backend/routes/orders.js:54
5. App P: backend/routes/products.js:181
6. App T: server/routes/plugins.js:66
7. App R: Backend/src/controllers/authController.js:225
8. App M: backend/src/middlewares/user.verification.js:11
9. App Q: apps/server/src/controllers/order.ts:111
10. App I: backend/src/controllers/urlController.js:39

### LP003 held-out: every finding

The second labeller labelled the 10 findings listed above from the code, without reading this
table. Their label is noted on those 10 rows.

| # | Location | Case | Level | Label | Pattern | Reasoning |
|---|---|---|---|---|---|---|
| 1 | App I: backend/src/controllers/urlController.js:7 | A | high/medium | TP | I1 | Lists URLs from the database; a database failure becomes a generic 500 and is never logged. |
| 2 | App I: backend/src/controllers/urlController.js:25 | A | high/medium | TP | I1 | Same as #1, saving a new short URL. |
| 3 | App I: backend/src/controllers/urlController.js:39 | A | high/medium | TP | I1 | Same as #1. An unknown short ID even crashes on `url.clicks` (the URL is null) and ends here without a trace. (Second labeller agrees; check #10.) |
| 4 | App I: backend/src/controllers/urlController.js:49 | A | high/medium | TP | I1 | Same as #1, deleting a URL. |
| 5 | App J: backend/middleware/verifyToken.js:15 | E | medium/medium | Debatable | J1 | The JWT check answers 401 to every failure. Invalid tokens are expected; only a misconfiguration (such as a missing secret) would be unexpected. |
| 6 | App K: server/src/middleware/requireAuth.ts:14 | E | medium/medium | Debatable | K1 | Same as #5. |
| 7 | App L: backend/src/app.ts:72 | A | high/high | Debatable | L1 | Health check: a failed database ping answers 503 "Database unavailable"; logging every failed probe is a design choice. |
| 8 | App M: backend/src/middlewares/user.verification.js:11 | E | medium/medium | Debatable | M1 | Same as #5. (Second labeller: TP, unsure, with a reason that describes the file's other catch, line 22; see check #8.) |
| 9 | App N: backend/src/middleware/authMiddleware.ts:32 | E | medium/medium | Debatable | N1 | Token check with an explicit expired-token case; every other failure answers 401. |
| 10 | App N: backend/src/middleware/validate.ts:9 | B | high/medium | TP | N2 | Zod validation: a ZodError correctly answers 400, but the 500 branch for every other failure drops it without a trace. |
| 11 | App P: backend/routes/admin.js:80 | A | high/high | TP | P1 | Dashboard queries; a database failure becomes a generic 500 that is never logged. |
| 12 | App P: backend/routes/auth.js:92 | A | high/high | TP | P1 | Registration: a duplicate answers 409, every other failure a generic 500 with no log. (Second labeller agrees; check #1.) |
| 13 | App P: backend/routes/auth.js:124 | A | high/high | TP | P1 | Login: a database or hashing failure becomes a generic 500 with no log. |
| 14 | App P: backend/routes/categories.js:28 | A | high/high | TP | P1 | Same as #11, listing categories. |
| 15 | App P: backend/routes/categories.js:45 | A | high/high | TP | P1 | Same as #11, loading one category. |
| 16 | App P: backend/routes/categories.js:75 | A | high/high | TP | P1 | Same as #12, creating a category. (Second labeller agrees; check #2.) |
| 17 | App P: backend/routes/categories.js:121 | A | high/high | TP | P1 | Same as #12, updating a category. |
| 18 | App P: backend/routes/categories.js:146 | A | high/high | TP | P1 | Same as #11, deleting a category. |
| 19 | App P: backend/routes/checkout.js:191 | B | high/high | TP | P1 | Checkout transaction: validation errors answer 422 with their message; every other failure (stock update, database) a generic 500 with no log. (Second labeller agrees; check #3.) |
| 20 | App P: backend/routes/orders.js:30 | A | high/high | TP | P1 | Same as #11, listing orders. |
| 21 | App P: backend/routes/orders.js:54 | A | high/high | TP | P1 | Same as #11, loading one order. (Second labeller agrees; check #4.) |
| 22 | App P: backend/routes/orders.js:107 | B | high/high | TP | P1 | Order status transaction: errors that carry a status code answer with it; every other failure a generic 500 with no log. |
| 23 | App P: backend/routes/products.js:98 | A | high/high | TP | P1 | Same as #11, listing products. |
| 24 | App P: backend/routes/products.js:112 | A | high/high | TP | P1 | Same as #11, loading one product. |
| 25 | App P: backend/routes/products.js:144 | A | high/high | TP | P1 | Same as #12, creating a product. |
| 26 | App P: backend/routes/products.js:181 | A | high/high | TP | P1 | Same as #12, updating a product. (Second labeller agrees; check #5.) |
| 27 | App P: backend/routes/products.js:201 | A | high/high | TP | P1 | Same as #11, deleting a product. |
| 28 | App P: backend/server.js:70 | A | high/high | Debatable | P2 | Health check, as #7. |
| 29 | App Q: apps/server/src/controllers/order.ts:45 | C | high/medium | TP | Q1 | `console.error()` is called without the error, so the log line is empty; creating the order and updating stock can fail. |
| 30 | App Q: apps/server/src/controllers/order.ts:72 | C | high/medium | TP | Q1 | Same as #29. |
| 31 | App Q: apps/server/src/controllers/order.ts:90 | C | high/medium | TP | Q1 | Same as #29. |
| 32 | App Q: apps/server/src/controllers/order.ts:111 | C | high/medium | TP | Q1 | Same as #29. (Second labeller agrees; check #9.) |
| 33 | App Q: apps/server/src/controllers/order.ts:180 | C | high/medium | TP | Q1 | Same as #29. |
| 34 | App Q: apps/server/src/controllers/product.ts:159 | C | high/medium | TP | Q1 | Same as #29. |
| 35 | App R: Backend/src/controllers/adminController.js:167 | A | high/medium | FP | R1 | The try only sends fields of the already-authenticated admin in a 200 response; nothing unexpected can plausibly reach the catch. |
| 36 | App R: Backend/src/controllers/authController.js:225 | A | high/medium | TP | R2 | Loads the current user from the database; a failure becomes a generic 500 with no log. (Second labeller agrees; check #7.) |
| 37 | App R: Backend/src/middleware/adminMiddleware.js:64 | E | medium/medium | Debatable | R3 | Admin token check plus an admin lookup in the database: a database outage also answers 401 "Invalid or expired admin token", with no trace. |
| 38 | App R: Backend/src/middleware/authMiddleware.js:42 | E | medium/medium | Debatable | R3 | Same as #37, for users. |
| 39 | App S: backend/src/middleware/requireAuth.js:18 | E | medium/medium | Debatable | S1 | Same as #5. |
| 40 | App T: server/middleware/auth.js:132 | A | high/medium | TP | T1 | Token and session checks: JWT errors answer 401, but the 500 "Authentication error" branch drops database and other failures without a trace. |
| 41 | App T: server/routes/plugins.js:66 | E | medium/medium | Debatable | T2 | Creating a plugin: invalid input answers 400 with its message; an unexpected failure gets the same 400, so the admin sees a message but the server keeps nothing. (Second labeller: TP; see check #6.) |
| 42 | App T: server/routes/plugins.js:79 | E | medium/medium | Debatable | T2 | Same as #41, importing a plugin bundle. |
| 43 | App T: server/routes/plugins.js:95 | E | medium/medium | Debatable | T2 | Same as #41, updating a plugin. |

| Pattern | Findings | Label | What it is |
|---|---|---|---|
| I1 | 4 | TP | Controllers answer a database failure with a generic 500 and never log it |
| P1 | 17 | TP | Route handlers answer every unexpected failure with a generic 500, never logged |
| Q1 | 6 | TP | `console.error()` without the error, then a generic 500 |
| N2 | 1 | TP | A validation middleware's 500 branch for non-validation errors |
| R2 | 1 | TP | A database lookup answered with a generic 500 |
| T1 | 1 | TP | An authentication middleware's 500 branch |
| J1, K1, M1, S1 | 4 | Debatable | A JWT check answers 401 to every failure |
| N1 | 1 | Debatable | A token check with an explicit expired-token case |
| R3 | 2 | Debatable | A token check plus a database lookup, all answered with 401 |
| T2 | 3 | Debatable | Plugin endpoints answer 400 with the error message |
| L1, P2 | 2 | Debatable | Health checks |
| R1 | 1 | FP | Nothing in the try can plausibly fail |

### LP003 second-labeller check

**Status: done.** The project owner labelled the 10 findings
[listed above](#current-results-lp003-on-held-out-express-apps) blind. They worked from the code at
the pinned commits and the LP003 definitions under [Labels](#labels). As in
[round 2](#second-labeller-check):

- they are a beginner and asked that their labels be treated as an independent second opinion, not
  as the correct answer;
- every disagreement was settled by re-reading the code, not by deferring to either side.

One difference from round 2: they had seen the headline LP003 numbers (for example "case E: 0 of
10") before labelling, but not the per-finding table. They labelled from the code only.

Before the comparison, the sealed file was checked:

- the sealed file still had the SHA-256 published above,
  `cfdf8870eafcfeee4126b6b60422d066a430e415941ee8ca31798556673f91c3`;
- its 10 labels equal the label file behind every number in this section.

The sealed file is published as an anonymized copy,
[eval-data/sealed/lp003-second-labeller-claude-labels.anon.json](eval-data/sealed/lp003-second-labeller-claude-labels.anon.json)
(see [Evaluation data and anonymized apps](#evaluation-data-and-anonymized-apps)). The second
labeller's labels and reasons are in
[eval-data/second-labeller/lp003-owner-labels.anon.json](eval-data/second-labeller/lp003-owner-labels.anon.json).
`node docs/eval-data/scripts/second-labeller-compare.mjs` recomputes the agreement and kappa, and
`node docs/eval-data/scripts/precision.mjs` the three views below.

| # | Finding | Case | LogPilot level | Claude (sealed) | Second labeller | After re-reading the code |
|---|---|---|---|---|---|---|
| 1 | App P: backend/routes/auth.js:92 | A | high/high | TP | TP | agree |
| 2 | App P: backend/routes/categories.js:75 | A | high/high | TP | TP | agree |
| 3 | App P: backend/routes/checkout.js:191 | B | high/high | TP | TP | agree |
| 4 | App P: backend/routes/orders.js:54 | A | high/high | TP | TP | agree |
| 5 | App P: backend/routes/products.js:181 | A | high/high | TP | TP | agree |
| 6 | App T: server/routes/plugins.js:66 | E | medium/medium | Debatable | TP | Debatable more likely under the written definitions, but close (see below) |
| 7 | App R: Backend/src/controllers/authController.js:225 | A | high/medium | TP | TP | agree |
| 8 | App M: backend/src/middlewares/user.verification.js:11 | E | medium/medium | Debatable | TP (unsure) | Debatable more likely: the TP reason describes the file's other catch, line 22 |
| 9 | App Q: apps/server/src/controllers/order.ts:111 | C | high/medium | TP | TP | agree |
| 10 | App I: backend/src/controllers/urlController.js:39 | A | high/medium | TP | TP | agree |

| Measure | Value |
|---|---|
| Agreement on the 3 labels (TP / Debatable / FP) | 8 of 10 |
| Cohen's kappa, 3 labels | **0.00** (chance agreement 0.80) |
| Agreement on "real problem or not" (TP vs not TP, the only distinction precision uses) | 8 of 10, kappa **0.00** (chance agreement 0.80) |
| Agreement at high severity | 8 of 8 |
| Agreement at medium severity (case E) | 0 of 2 |
| After re-reading: second labeller more likely right | 0 |
| After re-reading: Claude more likely right | 2 (#6, which is close; #8) |

**Why kappa is 0 although we agreed 8 times out of 10.**

- Kappa compares the agreement with the agreement expected by chance, given how often each
  labeller uses each label.
- The second labeller labelled all 10 TP. A random pairing would then agree every time Claude says
  TP, which is 8 times out of 10.
- 80% observed minus 80% by chance leaves nothing, so kappa is 0.

Whenever one labeller gives every item the same label and the other does not, kappa is 0,
whatever the other labeller does. So kappa cannot say anything about this check. The useful facts
are the two agreement rows below it: full agreement on all 8 high-severity findings, and
disagreement on both case E findings.

#### LP003 disagreements, side by side

| # | Claude's reasoning (sealed label) | Second labeller's reasoning | Who is more likely right after re-reading, and why |
|---|---|---|---|
| 6 | Debatable: "Creating a plugin: invalid input answers 400 with its message; an unexpected failure gets the same 400, so the admin sees a message but the server keeps nothing." | TP: "The error message is returned to the client, but the original error object and stack are neither logged nor propagated. Client-facing error responses are not a substitute for server-side diagnostics." | **Claude under the definitions as written, but it is close.** The try calls the app's plugin-registry service. Most of what that throws comes from a small helper that builds validation errors with a code. A comment in the service says these validation errors have stable codes that the UI translates: for them, a 400 with the message is the intended answer. The same try also runs SQLite queries and an audit write. Their failures get the same 400 and no log. That is the case the Debatable definition names: "anticipated and unexpected failures are mixed, and the response is right for the anticipated one". The second labeller's principle is right: a message shown to the admin is not a record on the server, the stack is gone, and a database failure is answered as if the admin had made a mistake. That is the strongest argument for keeping case E at all. |
| 8 | Debatable: "The JWT check answers 401 to every failure. Invalid tokens are expected; only a misconfiguration (such as a missing secret) would be unexpected." | TP (unsure): "console.error logs only error.message, not the complete error object or stack. Some diagnostic information is retained, but the stack and additional error context are lost." | **Claude, for the flagged line.** The file has two catches. The flagged one, line 11, is `catch {` around `jwt.verify(...)`; it answers 401 and calls no `console.error`. The second labeller's reason describes the other catch, line 22, around the database lookup: it logs `error.message` and answers 500. For line 11, `jwt.verify` throws for expired, malformed or wrongly signed tokens. All of those are expected, and 401 is the right answer. Only a server misconfiguration would be unexpected and hidden: without the signing secret in the environment, every check fails. That makes it debatable, like the other JWT checks (patterns J1, K1, S1). |

**What each side missed, in simple terms.**

- **#8: the label was given to a different catch.**
  - LogPilot's line number points at the `catch` keyword, and the evidence shows that catch's
    code: here `} catch {` and a 401.
  - When a file has several catches, match the line number and the evidence before labelling.
  - The same slip happened twice in round 2 ([#1 and #4](#the-disagreements-side-by-side)), so it
    is worth making a habit.
- **#6: the reason weighed what is lost on the unexpected path, not what the catch is for.**
  - The anticipated failure (invalid plugin input, with a stable code for the UI) gets exactly the
    right answer.
  - Under our definitions, a catch that gives every failure the one 4xx answer that suits the
    expected failure (a 401 for a bad token, a 400 for invalid input) is debatable. That is how all
    43 findings were labelled:
    - catches whose unexpected failures end in a 5xx answer with no record are TP. The 500 can be
      the only answer (App I) or a separate branch next to the expected failure's own
      answer (App P, App N #10, App T #40);
    - catches that give every failure one 4xx answer are debatable (the JWT checks, the plugin
      endpoints);
    - health checks are the one stated exception: debatable, although they answer 503.
  - Claude's label rests on that definition, not on a fact the second labeller overlooked. If the
    definitions change so that "an unexpected failure answered with a 4xx and no log" counts as
    TP, #6 and its pattern T2 become TP.

**Was the second labeller right about line 22?** In substance, yes.

- The catch at line 22 logs a fixed text plus `error.message`. That keeps the message but drops
  the stack, the error's class and properties such as `code`.
- LP003 does not report it, on purpose:
  - LP003 counts any value made from the error and passed to a function other than the response as
    kept ([README](../README.md#lp003-in-more-detail));
  - its TP definition is "no record of the error", and a message is a record, if a weak one;
  - this exact catch was in the pre-registered recall sample. Before the scan it was classified
    "not an instance: logged (message)".
- So it is not a rule bug and not a missed LP003 finding. It is a different gap: a log line with
  weak error context. That is the "weak failure context" rule family, which does not exist yet.

**Rule bugs found: none.** In both disagreements LogPilot read the code correctly. So no fixture
was added, and LP003 was not changed: it stays frozen. Two observations for a later version:

1. Logging only part of the error (`console.error(err.message)`) counts as kept. The README says
   so, but no test pins it down.
2. Case E is checked before case B. So #6's explanation says "never logs the error" but not that
   the error's message also goes to the client; only the evidence snippet shows that.

#### LP003 precision under three views

- **View 1:** Claude's labels, as recorded.
- **View 2:** the second labeller's label wherever we disagree (#6 and #8 become TP).
- **View 3:** a finding is a real problem only if everyone who labelled it said TP. For the 33
  findings with one labeller, that is Claude's label.

| | View 1: Claude's labels | View 2: second labeller wins disagreements | View 3: TP only if both say TP |
|---|---|---|---|
| **All 43 findings** | **30/43 (70%)** | **32/43 (74%)** | **30/43 (70%)** |
| High severity | 30/33 (91%) | 30/33 (91%) | 30/33 (91%) |
| Medium severity (all case E) | 0/10 (0%) | 2/10 (20%) | 0/10 (0%) |
| Case A | 21/24 (88%) | 21/24 (88%) | 21/24 (88%) |
| Case B | 3/3 | 3/3 | 3/3 |
| Case C | 6/6 | 6/6 | 6/6 |
| Case D | no findings | no findings | no findings |
| Case E | 0/10 (0%) | 2/10 (20%) | 0/10 (0%) |
| Confidence high | 17/19 (89%) | 17/19 (89%) | 17/19 (89%) |
| Confidence medium | 13/24 (54%) | 15/24 (63%) | 13/24 (54%) |
| The 10 double-labelled findings (not a precision estimate) | 8/10 | 10/10 | 8/10 |

What this shows:

- **High severity is 30 of 33 (91%) in every view.** Every disagreement is at medium severity, in
  case E.
- **View 3 equals view 1,** because Claude never said TP where the second labeller did not.
- **In view 2, case E is 2 of 10.**
  - Applying the second labeller's #6 label to the other two findings of the same pattern (T2:
    #42 and #43 in the table) would make case E 4 of 10, and 34 of 43 (79%) overall.
  - #8's label is not carried over to its pattern, because its reason is about a different catch.
- **Case E stays far below the other cases in every view,** so medium severity fits it. Whether to
  report it at all is still a question for later.
- **"8 of 10" is not a precision estimate.** The 10 were picked from groups (6 A/high, 2 E/medium,
  1 B/high, 1 C/high), and 5 of them come from App P.

**Limits of this check.**

- Only 2 of the 10 findings were case E, where the hard line is. The 8 high-severity ones were the
  easy part.
- One of the two disagreements (#8) is about different code. The real difference in judgement is
  one finding (#6).
- The second labeller had seen the headline numbers.

**Label-guide points this suggests** (for future rounds; the recorded labels stay as they are):

1. Before labelling, match the line number and the evidence to one catch. If the file has several,
   name the line in the reason.
2. Write down the line Claude's labels already follow:
   - unexpected failures that end in a 5xx answer with no record are TP, whether the 500 is the
     only answer or a branch next to the expected failure's own answer;
   - a catch that gives every failure the one 4xx answer that suits the expected failure is
     debatable;
   - health checks are debatable.
3. Decide whether an error message sent to the requester (case E with the message, as in #6)
   should move a finding from debatable to TP. The second labeller says yes. This is the project
   owner's decision, before the next round.

## Current results: LP001 v2 (round 3, held-out)

Round 3 measured **LP001 version 2** (Milestone 2.5) on knex and node-postgres. The three changes
in version 2:

- a comment lowers only confidence, never severity;
- tool directives (`eslint-disable`, `@ts-ignore`, `istanbul ignore`, ...) are not explanations;
- more swallowed test assertions are recognised.

Both repositories were cloned and their try/catch statements counted in round 2. They were then
left unscanned until LP001 v2 was finished and its tests passed. Labels follow the guide in
[Labels](#labels), including the clarifications for round 3 on. **LP002 findings in these two
repositories were filtered out unseen** (LP002 did not change), so they stay held-out for LP002.

| | knex | node-postgres | Both |
|---|---|---|---|
| Files scanned | 472 | 270 | 742 |
| LP001 findings | 19 | 6 | 25 |
| High severity | no findings | no findings | no findings |
| Medium severity | 3/18 (17%) | 0/6 (0%) | **3/24 (13%)** |
| Low severity | 0/1 | no findings | 0/1 |
| **All** | **3/19 (16%)** | **0/6 (0%)** | **3/25 (12%)** |
| Raw counts (TP / debatable / FP) | 3 / 2 / 14 | 0 / 1 / 5 | 3 / 3 / 19 |
| Distinct patterns (TP patterns) | 9 (1) | 4 (0) | 13 (1) |

What this shows:

- **12% of LP001 v2's findings on unseen code are real problems.** All 3 are one repeated decision
  (pattern P9 below), so with 25 findings and a single true-positive pattern, this number can
  swing a lot.
- **No finding was high.** No existence check and no swallowed test assertion appeared. The longer
  assertion list therefore had no effect here; on the tuning data it did (see the check below).
- **Severity still does not separate real problems from noise.**
  - LP001 v1 would have reported all 25 findings at *low / medium*. This was checked by running v1
    on the same code; it finds the same 25 catches.
  - Version 2 moved the 3 true positives to *medium*, which is right: their comment ("pg may not be
    installed") was wrong.
  - But it moved 21 findings that are not true positives to *medium* with them.
- **Directive-only catches were not real problems here.** Five catches have only an
  `// eslint-disable-next-line no-empty` directive next to them. They now get confidence *high*,
  and none is a true positive (4 FP, 1 debatable). A directive is not an explanation, but it does
  show that someone noticed the empty catch. Five findings are too few to act on.
- By confidence: *high* 0/5, *medium* 3/20 (15%).
- **One labeller.** All labels are Claude's, following the guide; there was no second-labeller
  check this round. Every finding links to the exact line, so anyone can re-check it.

**Tuning-data check (not a precision claim).** On the MongoDB driver's own code, where change 3 was
designed:

- the 4 true positives of pattern A (`test.ok(false)`, with `test` an assertion library) are now
  *high / high*, and they are the only high findings (high 4/4, medium 0/14);
- pattern F's three findings now share one level. Before, an `eslint-disable` line had lowered one
  of them.

**Version measured:** LogPilot commit `5c9a4a6` (v0.2.0) plus the uncommitted LP001 v2 changes
(SHA-256 of `git diff HEAD -- src/rules/lp001-empty-catch.ts` starts with `d47e0b63e900b465`).

### knex: every LP001 finding

| # | Location | Rule | Level | Label | Pattern | Reasoning |
|---|---|---|---|---|---|---|
| 1 | [bin/cli.js:155](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/bin/cli.js#L155) | LP001 | medium/medium | FP | P1 | The CLI reads the local knex `package.json` only to print "Knex Local version"; any failure prints "None". Display only, no effect on what the CLI does. |
| 2 | [bin/utils/cli-config-utils.js:187](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/bin/utils/cli-config-utils.js#L187) | LP001 | medium/medium | Debatable | P2 | Looks up the nearest `package.json`. "None found" (expected, and it throws here) looks the same as a corrupt file; both make the CLI fall back to the next way of finding knex. |
| 3 | [lib/dialects/mssql/transaction.js:129](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/lib/dialects/mssql/transaction.js#L129) | LP001 | medium/medium | FP | P3 | Attaches the original error to the rollback error, which is rejected right after; the comment links the issue where that assignment can throw. Only extra detail is lost. |
| 4 | [lib/dialects/postgres/index.js:135](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/lib/dialects/postgres/index.js#L135) | LP001 | medium/medium | FP | P4 | A best-effort server version check for native pools. On failure the version stays unknown and is checked again on the next connection; it only changes column types for PostgreSQL older than 9.2. |
| 5 | [lib/migrations/migrate/Migrator.js:574](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/lib/migrations/migrate/Migrator.js#L574) | LP001 | low/high | Debatable | P5 | While a failed migration's error is rethrown, freeing the migration lock can fail silently. The main error is kept, but the lock stays held and the next run fails with "Can't take lock" without the reason. (Its only comment is an `eslint-disable` directive.) |
| 6 | [scripts/stress-test/knex-stress-test.js:137](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/scripts/stress-test/knex-stress-test.js#L137) | LP001 | medium/medium | FP | P6 | A stress-test script deletes an old proxy before creating it. "No such proxy" is expected; any other problem makes the next call fail with its own error. |
| 7 | [scripts/stress-test/mysql2-random-hanging-every-now-and-then.js:89](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/scripts/stress-test/mysql2-random-hanging-every-now-and-then.js#L89) | LP001 | medium/medium | FP | P6 | Same as #6. |
| 8 | [scripts/stress-test/mysql2-sudden-exit-without-error.js:17](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/scripts/stress-test/mysql2-sudden-exit-without-error.js#L17) | LP001 | medium/medium | FP | P6 | Same as #6. |
| 9 | [scripts/stress-test/reconnect-test-mysql-based-drivers.js:120](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/scripts/stress-test/reconnect-test-mysql-based-drivers.js#L120) | LP001 | medium/medium | FP | P6 | Same as #6. |
| 10 | [test/integration/execution/transaction.js:797](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/integration/execution/transaction.js#L797) | LP001 | medium/medium | FP | P8 | A test about who releases the connection ignores whether the empty transaction failed; the comment says so, and the check is about the release. |
| 11 | [test/integration2/dialects/mariadb.spec.js:168](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/integration2/dialects/mariadb.spec.js#L168) | LP001 | medium/medium | FP | P7 | The test throws on purpose to force a rollback, ignores that error, and checks that no row was saved. |
| 12 | [test/integration2/pool/connection-pool.spec.js:80](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/integration2/pool/connection-pool.spec.js#L80) | LP001 | medium/medium | FP | P7 | Same as #11, with a NOT NULL violation as the forced failure. |
| 13 | [test/integration2/query/misc/additional.spec.js:190](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/integration2/query/misc/additional.spec.js#L190) | LP001 | medium/high | FP | P7 | The test throws inside a stream loop on purpose and checks that the connection was released. (Its only comment is an `eslint-disable` directive.) |
| 14 | [test/unit/client/connection-pool.js:217](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/unit/client/connection-pool.js#L217) | LP001 | medium/medium | TP | P9 | The comment says "pg may not be installed", but this loads knex's own PostgreSQL dialect, which loads `pg` only later, in `_driver()`. So only a real bug in knex's own code can reach this catch, and it silently turns the dialect's unit tests into skipped tests. |
| 15 | [test/unit/client/connection-pool.js:291](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/unit/client/connection-pool.js#L291) | LP001 | medium/medium | TP | P9 | Same as #14, for the MySQL dialect. |
| 16 | [test/unit/client/connection-pool.js:364](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/unit/client/connection-pool.js#L364) | LP001 | medium/medium | TP | P9 | Same as #14, for the MySQL2 dialect. |
| 17 | [test/unit/knex.js:790](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/unit/knex.js#L790) | LP001 | medium/high | FP | P7 | The test runs a query that fails on purpose and checks the same error through a `query-error` listener. (Its only comment is an `eslint-disable` directive.) |
| 18 | [test/unit/knex.js:808](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/unit/knex.js#L808) | LP001 | medium/high | FP | P7 | Same as #17, and it also checks the error message. |
| 19 | [test/unit/knex.js:827](https://github.com/knex/knex/blob/e25d54bcb707714a17f5a5744eba5c4246bb4d1d/test/unit/knex.js#L827) | LP001 | medium/high | FP | P7 | Same as #18. |

| Pattern | Findings | Label | What it is |
|---|---|---|---|
| P1 | 1 | FP | The CLI reads a `package.json` only to display a version |
| P2 | 1 | Debatable | A `package.json` lookup where "not found" and "corrupt" look the same |
| P3 | 1 | FP | Adding detail to an error that is kept anyway |
| P4 | 1 | FP | A best-effort server version check |
| P5 | 1 | Debatable | Freeing a lock while a failure is rethrown |
| P6 | 4 | FP | Stress-test scripts delete a proxy that may not exist |
| P7 | 6 | FP | A test causes a failure on purpose and checks its outcome another way |
| P8 | 1 | FP | A test ignores a failure that is irrelevant to what it checks |
| P9 | 3 | TP | A test hook loads knex's own module "in case a driver is missing"; a real failure skips the tests |

### node-postgres: every LP001 finding

| # | Location | Rule | Level | Label | Pattern | Reasoning |
|---|---|---|---|---|---|---|
| 1 | [packages/pg-query-stream/test/async-iterator.ts:99](https://github.com/brianc/node-postgres/blob/2a5850fb0db18f5e40a642bbb4a4743de412ab54/packages/pg-query-stream/test/async-iterator.ts#L99) | LP001 | medium/medium | FP | Q1 | The test iterates an already-stopped stream again, ignores the error newer Node versions throw there (the comment says so), and checks that no more rows arrived. |
| 2 | [packages/pg/bench-pipelining.js:7](https://github.com/brianc/node-postgres/blob/2a5850fb0db18f5e40a642bbb4a4743de412ab54/packages/pg/bench-pipelining.js#L7) | LP001 | medium/medium | Debatable | Q2 | A benchmark loads the optional `pg-native`. "Not installed" is expected, but a broken install looks the same and silently drops the native benchmarks (the same shape as second-labeller check #6). |
| 3 | [packages/pg/lib/defaults.js:6](https://github.com/brianc/node-postgres/blob/2a5850fb0db18f5e40a642bbb4a4743de412ab54/packages/pg/lib/defaults.js#L6) | LP001 | medium/medium | FP | Q3 | Reads an environment variable, which only throws in Deno without `--allow-env` (the comment says so); the default user then stays undefined, as intended. |
| 4 | [packages/pg/lib/index.js:42](https://github.com/brianc/node-postgres/blob/2a5850fb0db18f5e40a642bbb4a4743de412ab54/packages/pg/lib/index.js#L42) | LP001 | medium/medium | FP | Q3 | Same as #3, for `NODE_PG_FORCE_NATIVE`. |
| 5 | [packages/pg/test/integration/gh-issues/3772-tests.js:52](https://github.com/brianc/node-postgres/blob/2a5850fb0db18f5e40a642bbb4a4743de412ab54/packages/pg/test/integration/gh-issues/3772-tests.js#L52) | LP001 | medium/medium | FP | Q4 | Test teardown destroys sockets that may already be closed. |
| 6 | [packages/pg/test/integration/gh-issues/3772-tests.js:156](https://github.com/brianc/node-postgres/blob/2a5850fb0db18f5e40a642bbb4a4743de412ab54/packages/pg/test/integration/gh-issues/3772-tests.js#L156) | LP001 | medium/medium | FP | Q4 | Test teardown: `client.end()` is expected to reject because the test reset the connection on purpose. |

| Pattern | Findings | Label | What it is |
|---|---|---|---|
| Q1 | 1 | FP | A test ignores an expected error and checks its outcome |
| Q2 | 1 | Debatable | A benchmark detects an optional native module |
| Q3 | 2 | FP | Reading environment variables, guarded for Deno |
| Q4 | 2 | FP | Test teardown that may fail after a deliberate reset |

## Round 2 results (held-out)

These projects played no part in designing the rules, and were scanned only with the round-2
version. Precision = true positives ÷ labelled findings; debatable counts as "not a true
positive". "Project code only" leaves out 258 findings inside vendored third-party libraries; see
[Mature code](#round-2-held-out-mature-code-mongodb-nodejs-driver).

| | Mature: all findings | Mature: project code only | Beginner: 3 apps |
|---|---|---|---|
| Project | MongoDB Node.js driver | MongoDB Node.js driver | 3 Express/MERN apps |
| Files scanned | 1,027 | 1,027 | 176 (100 + 15 + 61) |
| Findings | 288 | 30 | 11 (11 + 0 + 0) |
| High severity | 0/1 | 0/1 | no findings |
| Medium severity | 1/190 (1%) | 1/4 (25%) | 0/4 (0%) |
| Low severity | 5/97 (5%) | 5/25 (20%) | 1/7 (14%) |
| **All** | **6/288 (2%)** | **6/30 (20%)** | **1/11 (9%)** |
| Distinct patterns (TP patterns) | 15 (3) | 14 (3) | 3 (1) |

**The 70% target for high severity cannot be confirmed or refuted on unseen code.** Only one
held-out finding is high severity, and it is debatable. What the numbers do show:

- **Requiring positive evidence for "high" made high-severity findings rare.** That keeps noise
  out of "high", but the existence-check evidence never fired on held-out code.
- **Real problems landed mostly at *low* severity.** 6 of the 7 held-out true positives are low,
  and the rule that a comment lowers severity is the main cause:
  - swallowed test assertions next to `// should throw` or `// eslint-disable-line`;
  - a money calculation that silently keeps a stale discount, next to a comment saying so.

  So severity does not yet separate real problems from noise.
- **On the mature project, 90% of findings (258 of 288) were in vendored third-party libraries**
  (copies of jQuery and others in its documentation site). File selection, not the rules, was the
  biggest source of noise.
- **Beginner apps barely trigger the current rules.** Two of three had no findings: their catch
  blocks log the error or send an HTTP error response, which LP001 and LP002 do not judge.

Precision by rule and severity, raw counts in brackets (TP / debatable / FP):

| Rule | Severity | Mature, all | Mature, project code only | Beginner |
|---|---|---|---|---|
| LP001 | high | no findings | no findings | no findings |
| LP001 | medium | 0/187 (0 / 2 / 185) | 0/2 (0 / 2 / 0) | 0/4 (0 / 1 / 3) |
| LP001 | low | 4/88 (4 / 2 / 82) | 4/16 (4 / 2 / 10) | 1/7 (1 / 0 / 6) |
| LP002 | high | 0/1 (0 / 1 / 0) | 0/1 (0 / 1 / 0) | no findings |
| LP002 | medium | 1/3 (1 / 1 / 1) | 1/2 (1 / 1 / 0) | no findings |
| LP002 | low | 1/9 (1 / 2 / 6) | 1/9 (1 / 2 / 6) | no findings |

## Method

### Tuning set and held-out set

Changing a rule until its numbers look good on the code you are measuring would only prove the
rule fits that one codebase. So the projects play separate roles, and a held-out project becomes
tuning data as soon as its results have been used to change a rule:

| Round | Tuning data (rules designed from it; numbers optimistic) | Held-out data (cloned and scanned only after tuning, with the tuned version only) |
|---|---|---|
| 1 (LP001 tuning) | Vite | Mongoose |
| 2 (high severity needs positive evidence) | Vite, Mongoose | MongoDB Node.js driver (mature), 3 Express/MERN apps (beginner) |
| 3 (LP001 v2, Milestone 2.5) | Vite, Mongoose, MongoDB driver, the 3 apps | knex, node-postgres: LP001 only; their LP002 findings were filtered out unseen |
| LP003 (Milestone 2.5) | 4 Express apps chosen by `lp003-selection-protocol.md`, plus the 3 round-2 apps | 12 Express/MERN apps chosen by the same protocol; only their LP003 findings were looked at |
| next | the above; LP001 is frozen at version 2 | knex and node-postgres stay unseen for LP002; new Express apps are needed for LP003 |

Express was scanned once before any tuning, as a sanity check; it has no findings (see below).

### Labels

Every labelled finding gets one of three labels, decided by reading the real code at the pinned
commit:

- **True positive (TP):** the swallowed or lost error is one an investigator could plausibly need,
  because an *unexpected* failure is silently turned into different behaviour (or, in tests, the
  swallow defeats a test assertion).
- **False positive (FP):** losing the error does not hurt an investigation. The failure is the
  anticipated one and the fallback is the intended handling, or the work is optional (cleanup,
  caching, probing, adding detail to an error that is kept anyway), or it is test/demo code where
  the error is irrelevant.
- **Debatable:** the catch mixes an anticipated failure (for example "file missing") with plausible
  unexpected ones (for example "file corrupt" or "permission denied"), behaviour silently changes,
  and reasonable maintainers could disagree about whether a trace is needed.

LP001 (empty catch) findings were labelled with this decision procedure, applied in order:

1. Test or demo code where the error is irrelevant to what the code checks → FP.
   Exception: the swallow also hides a test assertion's failure → TP.
2. Optional or best-effort work whose failure has no effect on results → FP.
3. Only the anticipated failure can reach the catch (the code or a comment pins it down), and the
   fallback is the intended handling → FP.
4. The code already handles the expected case before the try (for example an existence check),
   so the catch only hides unexpected errors that silently change behaviour → TP.
5. Anticipated and unexpected failures are mixed, with a silent behaviour change → debatable.

LP002 (lost error cause) findings were labelled with the same definitions. A new error that
deliberately *translates* a well-understood failure into a clearer message is debatable, not TP.
If the caught error is only an internal signal with no information of its own (for example a
timer object that means "timed out"), replacing it loses nothing: FP.

**Clarifications for future rounds (from round 3 on).** These came out of the
[second-labeller check](#second-labeller-check), where the line between "debatable" and "FP" was
not shared (kappa 0.09). They apply to findings labelled from round 3 on. Labels recorded in
rounds 1 and 2, including the second-labeller check, stay exactly as recorded, so earlier numbers
remain comparable.

1. **Read the whole try block first.** List every call inside the try that can fail, not only the
   one a nearby comment talks about: a catch is judged by everything it can receive. Example: a
   try that looks up an entity *and* closes it can swallow a real close failure, even though the
   comment only mentions the expected "wrong type" error from the lookup.
2. **A translation that identifies the error exactly is FP.** When the code identifies the caught
   error exactly (an `if` on its exact message, its exact class, or an error code with a single
   meaning) and the new error carries at least the same information, nothing useful is lost.
   - The rule "a deliberate translation is debatable" applies only when the original error can
     carry information the new one lacks, such as a parser's position, an operating-system error
     code, or the underlying reason for a network failure.
3. **Judge by consequence, not by shape.** For catches that look like feature detection, a fallback
   or an optional step, ask what a failure silently changes.
   - If it changes what the program or test run does (which value is used, which path is taken,
     which tests run), and an expected failure looks the same as an unexpected one, the finding is
     at least debatable.
   - Only "optional, with no effect on results" stays FP.

**LP003 (unlogged error response) labels, from Milestone 2.5 on.** Written after tuning and before
the held-out scan:

- **TP:** an unexpected server-side failure (database, network, external service, a bug) can
  plausibly reach this catch or error middleware, and when it does, the server keeps no record of
  the error: the developer would see at most a status code.
- **FP:** the error is recorded after all, in a way LogPilot missed; or the code is not an Express
  request handler; or nothing unexpected can plausibly reach it; or it is generated, vendored, test
  or demo code.
- **Debatable:** anticipated and unexpected failures are mixed, and the response is right for the
  anticipated one (for example a 401 for a wrong password, which an outage of the login service
  also gets); or it is a probe such as a health check, where logging every failure is a design
  choice; or reasonable maintainers could disagree.
- The rest of the guide applies as written above: read the whole try block, and judge by what an
  unexpected failure would leave behind.

**Vendored code.** A finding inside a third-party library file copied into a project (for example
a copy of jQuery in a documentation site) is FP for that project: it is not the project's code
and not its diagnostic gap. Such findings are labelled as one group, after checking the file
headers, and are also reported separately ("project code only").

**Distinct patterns.** Findings that are the same design decision repeated (the same idiom
copy-pasted, or the same helper shape across files) form one pattern. Patterns are counted next
to raw findings, so that one repeated decision does not dominate the numbers.

**Precision = TP ÷ labelled findings.** Debatable findings count as *not* true positives, so the
number errs on the low side.

### Limits of this method

- One main labeller: Claude, the AI assistant building LogPilot, following the procedure above.
  - A blind [second-labeller check](#second-labeller-check) on 10 findings agreed 10/10 on "true
    positive or not", but only 5/10 on the three labels (kappa 0.09).
  - After re-reading, 2 of Claude's 10 sealed labels look wrong (#2, #6, both debatable vs FP).
    The recorded labels are kept as sealed; none of this changes a precision number.
  - For LP003, a second blind check ([LP003 second-labeller check](#lp003-second-labeller-check))
    agreed on 8 of 10, including all 8 at high severity. Kappa is 0.00 only because the second
    labeller labelled all 10 TP.
    - Both disagreements are case E findings that Claude labelled debatable. After re-reading,
      Claude's labels look more likely right, one of them (#6) narrowly.
    - Precision is reported under three views there, including the second labeller's.
  - Every finding links to the exact line at a pinned commit so anyone can re-check it.
- Small numbers: a precision computed from a handful of findings can swing a lot with one label.
- Only findings are labelled. Problems LogPilot does not report (false negatives) are measured
  only where noted.
- No code from the evaluated projects is copied here: only file locations and our own reasoning.
  Student and beginner apps are anonymized (App A to App T); the mapping is kept privately.

## Repositories and versions

The student and beginner apps are listed by ID only. Their names, URLs and pinned commits are in a
mapping kept privately, to avoid publicly labelling students' code (see
[Evaluation data and anonymized apps](#evaluation-data-and-anonymized-apps)). App C does not appear
here: it was looked at in the round-2 walk, skipped by rule (d) and never scanned.

| Repository | Role | Commit |
|---|---|---|
| [expressjs/express](https://github.com/expressjs/express) | sanity check | [`43fca52d28a422c8be48fd489cbd4f2d6152bab6`](https://github.com/expressjs/express/tree/43fca52d28a422c8be48fd489cbd4f2d6152bab6) |
| [vitejs/vite](https://github.com/vitejs/vite) | tuning set | [`db8b1190abbb7e30aad0055f97dde02d7ed504c7`](https://github.com/vitejs/vite/tree/db8b1190abbb7e30aad0055f97dde02d7ed504c7) |
| [Automattic/mongoose](https://github.com/Automattic/mongoose) | round-1 held-out, then tuning data | [`07da07e5407565a83438e17415d651ba0c983219`](https://github.com/Automattic/mongoose/tree/07da07e5407565a83438e17415d651ba0c983219) |
| [mongodb/node-mongodb-native](https://github.com/mongodb/node-mongodb-native) | round-2 held-out (mature) | [`a255151d4d638cd4ffd807883d1b24f46d426278`](https://github.com/mongodb/node-mongodb-native/tree/a255151d4d638cd4ffd807883d1b24f46d426278) |
| App A | round-2 held-out (beginner) | kept privately |
| App B | round-2 held-out (beginner) | kept privately |
| App D | round-2 held-out (beginner) | kept privately |
| [knex/knex](https://github.com/knex/knex) | round-3 held-out for LP001 (LP002 findings not looked at) | [`e25d54bcb707714a17f5a5744eba5c4246bb4d1d`](https://github.com/knex/knex/tree/e25d54bcb707714a17f5a5744eba5c4246bb4d1d) |
| [brianc/node-postgres](https://github.com/brianc/node-postgres) | round-3 held-out for LP001 (LP002 findings not looked at) | [`2a5850fb0db18f5e40a642bbb4a4743de412ab54`](https://github.com/brianc/node-postgres/tree/2a5850fb0db18f5e40a642bbb4a4743de412ab54) |
| App E | LP003 tuning | kept privately |
| App F | LP003 tuning | kept privately |
| App G | LP003 tuning | kept privately |
| App H | LP003 tuning | kept privately |
| App I | LP003 held-out | kept privately |
| App J | LP003 held-out | kept privately |
| App K | LP003 held-out | kept privately |
| App L | LP003 held-out | kept privately |
| App M | LP003 held-out | kept privately |
| App N | LP003 held-out | kept privately |
| App O | LP003 held-out | kept privately |
| App P | LP003 held-out | kept privately |
| App Q | LP003 held-out | kept privately |
| App R | LP003 held-out | kept privately |
| App S | LP003 held-out | kept privately |
| App T | LP003 held-out | kept privately |

All clones were shallow (`git clone --depth 1`) and scanned on Windows with Node.js 22.23.4.

| LogPilot version | Meaning |
|---|---|
| **baseline** | commit `be0126b208f6bdb641eba68e60ea1eb5d30ed7da` (LP001 + LP002, before tuning) |
| **round 1** (called "tuned" below) | commit `15f0b4648af1c4dde27f90cddb7ad1d15083a5b5`: LP001 comment, nesting and test-assertion rules |
| **round 2** | `15f0b46` plus the uncommitted `src/` changes described in [Round 2](#round-2-high-severity-needs-positive-evidence) (SHA-256 of `git diff HEAD -- src` starts with `5a2d6413635c4904`); committed together with this update |
| **round 3** (LP001 v2) | `5c9a4a6` (v0.2.0) plus the uncommitted LP001 v2 changes (SHA-256 of `git diff HEAD -- src/rules/lp001-empty-catch.ts` starts with `d47e0b63e900b465`); see [Current results](#current-results-lp001-v2-round-3-held-out) |
| **LP003** (frozen) | `318499c` plus the uncommitted LP003 code (SHA-256 of `git diff HEAD -- src` starts with `d95a81e57a46cab8`; of all `src/` files, `15951ac6e86dd79a`); see [LP003](#current-results-lp003-on-held-out-express-apps) |
| **LP003 version 2** (not measured) | the frozen version above with case E lowered from medium to low severity, changed **after** the held-out measurement; see [LP003](#current-results-lp003-on-held-out-express-apps) |

## Round 1 summary (history)

**Precision at high severity**, LP001 and LP002 together. The target is at least 70% true positives.

| | Vite baseline (tuning set) | Vite tuned (tuning set) | Mongoose tuned (held-out) |
|---|---|---|---|
| High-severity findings | 32 | 15 | 15 |
| True positives | 5 | 5 | 1 |
| **Precision** | **16%** (5/32) | **33%** (5/15) | **7%** (1/15) |

**The target is missed by a wide margin, and the held-out number is the honest one.** The tuning
removed most of the noise *on the code it was designed on*, without demoting any true positive.
On unseen code, high-severity findings were mostly deliberate translations of well-understood
errors (LP002) and optional data files in documentation tooling (LP001).

Precision by rule and severity:

| Rule | Severity | Vite baseline | Vite tuned | Mongoose tuned |
|---|---|---|---|---|
| LP001 | high | 4/29 (14%) | 4/12 (33%) | 0/3 (0%) |
| LP001 | low | – | 0/17 (0%) | 0/4 (0%) |
| LP002 | high | 1/3 (33%) | 1/3 (33%) | 1/12 (8%) |
| LP002 | low | 0/1 (0%) | 0/1 (0%) | – |

Mongoose's LP002 numbers have **no false positives at all**: 11 of its 12 findings are
*debatable*, the same deliberate pattern repeated (see below). Precision here counts debatable as
"not a true positive", so it errs on the low side.

## Express (sanity check, baseline)

142 files, **0 findings**. Its 7 catch blocks all handle the error (log and exit, pass it to a
callback, or return a fallback), and none throws a new error, so 0 is correct for both rules.

## Vite: baseline

`logpilot scan vite`: 1,614 files, 33 findings. No crashes and no warnings. 4 files have syntax
errors and were scanned on a best-effort basis: 2 are deliberate syntax-error test fixtures, and
2 are Git symlinks that Windows checks out as small text files.

| Rule | Severity / confidence | Findings | TP | Debatable | FP | Precision |
|---|---|---|---|---|---|---|
| LP001 | high / high | 19 | 4 | 3 | 12 | 21% |
| LP001 | high / medium | 10 | 0 | 3 | 7 | 0% |
| **LP001** | **all (all high)** | **29** | **4** | **6** | **19** | **14%** |
| LP002 | high / high | 1 | 0 | 1 | 0 | 0% |
| LP002 | high / medium | 2 | 1 | 1 | 0 | 50% |
| LP002 | low / medium | 1 | 0 | 1 | 0 | 0% |
| **LP002** | **all** | **4** | **1** | **3** | **0** | **25%** |

### Vite baseline: every LP001 finding

Links point to the line at the pinned commit. "Step" is the decision-procedure step that decided
the label.

| # | Location | Level | Label | Step | Reasoning |
|---|---|---|---|---|---|
| 1 | [packages/vite/bin/vite.js:61](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/bin/vite.js#L61) | high/high | FP | 2 | Optional compile-cache flush on a timer; if it fails, only cache freshness is affected. |
| 2 | [packages/vite/bin/vite.js:63](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/bin/vite.js#L63) | high/high | FP | 2 | Turning on Node's compile cache is an optional speed-up; failure just means no cache. |
| 3 | [packages/vite/src/module-runner/runner.ts:446](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/module-runner/runner.ts#L446) | high/high | Debatable | 5 | Copies a module's exports one by one; a failed copy silently leaves that export missing, which would surface later as a confusing "undefined". |
| 4 | [packages/vite/src/node/\_\_tests\_\_/plugins/cssPreprocessorTeardown.spec.ts:40](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/__tests__/plugins/cssPreprocessorTeardown.spec.ts#L40) | high/medium | FP | 1 | Test code; the comment in the catch says the error is irrelevant to what the test checks. |
| 5 | [packages/vite/src/node/config.ts:1630](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/config.ts#L1630) | high/high | Debatable | 5 | Falls back to the unresolved project root when resolving its real path fails; sensible, but an unexpected failure (permissions, symlink loop) silently changes the root used everywhere. |
| 6 | [packages/vite/src/node/config.ts:2612](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/config.ts#L2612) | high/high | FP | 2 | A probe ("can it also be resolved as an import?") inside a catch whose original error is rethrown a few lines later; failure simply means "no". |
| 7 | [packages/vite/src/node/optimizer/index.ts:418](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/optimizer/index.ts#L418) | high/high | Debatable | 5 | A missing cache file is the normal first run, but a corrupt one silently triggers re-bundling, while every other re-bundling reason is logged. |
| 8 | [packages/vite/src/node/optimizer/index.ts:573](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/optimizer/index.ts#L573) | high/medium | FP | 2 | Best-effort deletion of a temporary folder (a comment says errors are ignored); failure only leaves clutter. |
| 9 | [packages/vite/src/node/packages.ts:19](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/packages.ts#L19) | high/high | TP | 4 | Runs only when Yarn PnP is active, so failing to load the PnP API is unexpected; Vite silently falls back to node_modules resolution, and later "package not found" errors would carry no trace of why. |
| 10 | [packages/vite/src/node/packages.ts:119](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/packages.ts#L119) | high/high | TP | 4 | An existence check runs first, so this only hides unexpected errors such as a corrupt package.json; the lookup silently moves on to parent folders. |
| 11 | [packages/vite/src/node/packages.ts:150](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/packages.ts#L150) | high/high | TP | 4 | Same pattern as #10: the file is known to exist, so a failure to load it is unexpected, and resolution silently uses a parent folder's package.json. |
| 12 | [packages/vite/src/node/plugins/assetImportMetaUrl.ts:156](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/plugins/assetImportMetaUrl.ts#L156) | high/medium | Debatable | 5 | A warning follows, so the failure is visible, but it always claims the file "doesn't exist at build time"; any other failure reason is dropped and the warning can mislead. |
| 13 | [packages/vite/src/node/plugins/css.ts:3448](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/plugins/css.ts#L3448) | high/high | FP | 2 | Only tries to add a friendlier hint to an error that is already being handled; that error is rethrown two lines later. |
| 14 | [packages/vite/src/node/plugins/html.ts:512](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/plugins/html.ts#L512) | high/medium | FP | 3 | The comment documents the one expected failure (a library throwing on removed content) and the conservative fallback. |
| 15 | [packages/vite/src/node/server/index.ts:1366](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/index.ts#L1366) | high/medium | Debatable | 5 | "File not found" is the expected non-pnpm case (the comment says so), but an unreadable or corrupt file in a real pnpm project is also silently treated as "not pnpm", which changes which folders may be served. |
| 16 | [packages/vite/src/node/server/middlewares/hostCheck.ts:40](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/middlewares/hostCheck.ts#L40) | high/high | FP | 3 | Deliberate: a comment directly above the try explains that placeholder origins cannot be parsed. |
| 17 | [packages/vite/src/node/server/middlewares/static.ts:100](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/middlewares/static.ts#L100) | high/medium | FP | 3 | URI decoding can only fail on a malformed URI (the comment says so); keeping the raw path is the intended handling. |
| 18 | [packages/vite/src/node/server/openBrowser.ts:102](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/openBrowser.ts#L102) | high/medium | FP | 2 | Optional attempt to reuse an existing browser tab; on failure the normal way of opening the browser is used. |
| 19 | [packages/vite/src/node/server/pluginContainer.ts:979](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/pluginContainer.ts#L979) | high/high | FP | 2 | Reads a source file only to draw a code frame for an error being formatted; that error is kept, and there is a fallback. |
| 20 | [packages/vite/src/node/server/pluginContainer.ts:1018](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/pluginContainer.ts#L1018) | high/high | FP | 2 | Same as #19. |
| 21 | [packages/vite/src/node/server/searchRoot.ts:48](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/searchRoot.ts#L48) | high/medium | FP | 3 | The file is known to be readable, so only a parse failure can occur, and the comment documents that JSON-with-comments files are deliberately not parsed. |
| 22 | [packages/vite/src/node/server/sourcemap.ts:66](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/sourcemap.ts#L66) | high/high | FP | 3 | Deliberate: a comment inside the try documents that the result is undefined for virtual modules and permission errors. |
| 23 | [packages/vite/src/node/server/ws.ts:114](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/ws.ts#L114) | high/high | FP | 3 | The comparison only throws when the token length differs (a comment after the catch says so), which correctly means "invalid token". |
| 24 | [packages/vite/src/node/server/ws.ts:313](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/ws.ts#L313) | high/high | FP | 3 | Parsing a message from a network client can only fail on malformed input; ignoring such messages is the intended handling. |
| 25 | [packages/vite/src/node/ssr/\_\_tests\_\_/ssrLoadModule.spec.ts:288](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/ssr/__tests__/ssrLoadModule.spec.ts#L288) | high/high | TP | 1 | The empty catch also swallows the "this must throw" assertion in the try, so that check can never fail. |
| 26 | [packages/vite/src/node/utils.ts:406](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/utils.ts#L406) | high/medium | Debatable | 5 | A "try" helper whose contract is "undefined on failure"; "not found" is already handled by an option, so this reports other errors (for example permission denied) as "file does not exist". |
| 27 | [playground/lib/src/main-helpers-injection.js:8](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/playground/lib/src/main-helpers-injection.js#L8) | high/high | FP | 1 | Demo fixture for a bundler test; the error is irrelevant to what it tests. |
| 28 | [playground/optimize-deps/injected-import.js:6](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/playground/optimize-deps/injected-import.js#L6) | high/medium | FP | 1 | Demo code; the comment explains why the failure is expected in some modes. |
| 29 | [playground/test-utils.ts:151](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/playground/test-utils.ts#L151) | high/high | FP | 1 | Test helper; reading the rules of a cross-origin stylesheet throws by design, and skipping it is correct. |

### Vite baseline: every LP002 finding

| # | Location | Level, case | Label | Reasoning |
|---|---|---|---|---|
| 1 | [packages/vite/src/node/config.ts:2368](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/config.ts#L2368) | high/medium, A3 (`catch {}`) | Debatable | Translates a URI-decoding failure into a clearer config error; the dropped error adds almost nothing. |
| 2 | [packages/vite/src/node/config.ts:2614](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/config.ts#L2614) | high/high, P1 | Debatable | Deliberate diagnosis: the code checks that the package is ESM-only and throws an actionable message; the cause would still show which paths were tried, but high/high overstates it. |
| 3 | [packages/vite/src/node/optimizer/index.ts:1169](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/optimizer/index.ts#L1169) | high/medium, A3 (`catch {}`) | TP | The parser's error, including the line and column of the syntax error, is discarded; "unable to parse" plus a file name alone is hard to act on. |
| 4 | [packages/vite/src/node/server/middlewares/transform.ts:352](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/server/middlewares/transform.ts#L352) | low/medium, P1+A2+A4 | Debatable | A "should never happen" check; attaching the error would help if it ever fires, and low/medium is the right level. |

**LP002 misses measured on Vite:** 6 places throw a new error from a catch block and drop the
caught one. LP002 reports 4. The other 2 build the error with a local helper function instead of
`new` ([importMetaGlob.ts:162](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/plugins/importMetaGlob.ts#L162),
[workerImportMetaUrl.ts:120](https://github.com/vitejs/vite/blob/db8b1190abbb7e30aad0055f97dde02d7ed504c7/packages/vite/src/node/plugins/workerImportMetaUrl.ts#L120)),
a documented limitation.

## LP001 tuning (designed on Vite only)

Three changes, all about how strongly an empty catch is reported. No finding is added or removed.

1. **A comment explains the ignore → severity low, confidence medium.** A comment counts when it
   is inside the catch, inside the try (only if nothing but spaces follows it on its line, so
   annotations for other tools such as `/* #__PURE__ */` inside code do not count), on the
   line(s) directly above the `try`, or right after the catch's `}` on the same line.
   *Before this tuning, a comment inside the catch gave severity high, confidence medium.*
2. **Inside another catch block whose error is still passed on → severity low.** "Passed on"
   means that catch's variable is thrown, returned, passed as an argument, or used as a property
   value or array element. The search stays within the same function.
3. **The try calls `expect.unreachable()`, `expect.fail()` or `assert.fail()` → always
   severity high, confidence high**, even with a comment, because the empty catch makes that test
   check impossible to fail.

## Vite: after tuning

Same findings, same labels (the code did not change, so every label still holds). Only the
severity and confidence moved.

| Rule | Severity / confidence | Findings | TP | Debatable | FP | Precision |
|---|---|---|---|---|---|---|
| LP001 | high / high | 12 | 4 | 3 | 5 | 33% |
| LP001 | low / high | 2 | 0 | 0 | 2 | 0% |
| LP001 | low / medium | 15 | 0 | 3 | 12 | 0% |
| LP002 | (unchanged) | 4 | 1 | 3 | 0 | 25% |

Before and after for LP001:

| | Before | After |
|---|---|---|
| Findings at high severity | 29 | 12 |
| True positives at high severity | 4 | 4 (none demoted) |
| False positives at high severity | 19 | 5 |
| Precision at high severity | 14% | 33% |

Which findings moved, by rule:

- **Rule 1 (comment), to low/medium (15):** #1, #2, #4, #8, #12, #14, #15, #16, #17, #18, #21,
  #22, #23, #26, #28. Of these, 12 are FP and 3 debatable.
- **Rule 2 (inside a handler that passes its error on), to low/high (2):** #6, #13. Both FP.
- **Rule 3 (test assertion):** #25 stays high/high, the only finding it applies to. It is a TP.
- **Still high/high (12):** #3, #5, #7 (debatable); #9, #10, #11, #25 (TP); #19, #20, #24, #27,
  #29 (FP).
  - #9 stays high only because the annotation-comment exception keeps rule 1 from applying.
  - #19 and #20 sit inside an error-formatting *method*, not a catch block, so rule 2 cannot
    see them.
  - #27 and #29 are demo and test-helper code.

## Mongoose: held-out, tuned version only

Cloned after the tuning was finished. 523 files, **19 findings (LP001: 7, LP002: 12)**, scanned
in 2.3 s. No crashes, no warnings, no files with parse errors. All findings are labelled, so no
sampling was needed.

| Rule | Severity / confidence | Findings | TP | Debatable | FP | Precision |
|---|---|---|---|---|---|---|
| LP001 | high / high | 3 | 0 | 2 | 1 | 0% |
| LP001 | low / medium | 4 | 0 | 0 | 4 | 0% |
| LP002 | high / medium | 12 | 1 | 11 | 0 | 8% |

### Mongoose: every LP001 finding

| # | Location | Level | Label | Step | Reasoning |
|---|---|---|---|---|---|
| 1 | [docs/js/theme-toggle.js:27](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/docs/js/theme-toggle.js#L27) | low/medium | FP | 2 | Documentation site: saving the theme choice in browser storage is optional, and the comment says the theme still works for the session. |
| 2 | [docs/source/index.js:7](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/docs/source/index.js#L7) | high/high | Debatable | 5 | Docs tooling loads an optional, generated data file: a missing file is expected, but a corrupt one also silently yields an empty sponsor list. |
| 3 | [lib/tracing.js:8](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/tracing.js#L8) | low/medium | FP | 3 | Feature detection: the diagnostics module is missing on some runtimes, as the comment says, and tracing is then simply off. |
| 4 | [lib/types/documentArray/methods/index.js:150](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/types/documentArray/methods/index.js#L150) | low/medium | FP | 3 | An id that cannot be cast falls back to the documented loose comparison a few lines later; "no match" is the intended result. |
| 5 | [scripts/loadSponsorData.js:53](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/scripts/loadSponsorData.js#L53) | high/high | FP | def. | Creates a folder that may already exist; any other failure (for example permissions) resurfaces at the next write into that folder, with its own error. |
| 6 | [scripts/website.js:40](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/scripts/website.js#L40) | high/high | Debatable | 5 | Same as #2: an optional generated data file, where a corrupt file is silently treated like a missing one. |
| 7 | [scripts/website.js:343](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/scripts/website.js#L343) | low/medium | FP | def. | Same as #5, and a comment directly above the try explains it. |

"def." means the label follows directly from the label definitions, because no single step of the
procedure fits: the failure is not silent, since it resurfaces at once.

### Mongoose: every LP002 finding

All 12 have the same shape: a `catch {}` without a variable around a call that converts a value,
followed by a new `CastError` that names the type, the value and the path. That makes all of them
case A3, at high/medium.

| # | Location | Label | Reasoning |
|---|---|---|---|
| 1 | [lib/helpers/query/cast$expr.js:158](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/cast$expr.js#L158) | Debatable | Translates the number converter's generic "not a valid number" error into a CastError that carries strictly more context; the dropped error adds almost nothing. |
| 2 | [lib/helpers/query/cast$expr.js:199](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/cast$expr.js#L199) | Debatable | Same as #1. |
| 3 | [lib/helpers/query/cast$expr.js:210](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/cast$expr.js#L210) | Debatable | Same as #1. |
| 4 | [lib/helpers/query/cast$expr.js:260](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/cast$expr.js#L260) | Debatable | Same as #1: in this file the converter is only ever the number converter. |
| 5 | [lib/helpers/query/cast$expr.js:266](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/cast$expr.js#L266) | Debatable | Same as #4. |
| 6 | [lib/helpers/query/castUpdate.js:593](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/castUpdate.js#L593) | Debatable | Same as #1. |
| 7 | [lib/helpers/query/castUpdate.js:651](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/helpers/query/castUpdate.js#L651) | Debatable | Same as #1. |
| 8 | [lib/query.js:927](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/query.js#L927) | Debatable | Same as #1, for a query's limit. |
| 9 | [lib/query.js:961](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/query.js#L961) | Debatable | Same as #1, for a query's skip. |
| 10 | [lib/query.js:1809](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/query.js#L1809) | Debatable | Same as #8. |
| 11 | [lib/query.js:1816](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/query.js#L1816) | Debatable | Same as #9. |
| 12 | [lib/schema/string.js:614](https://github.com/Automattic/mongoose/blob/07da07e5407565a83438e17415d651ba0c983219/lib/schema/string.js#L614) | TP | The cast function here can be supplied by the user, and its error is dropped. The CastError gets no `reason`, while the number, date, boolean and other schema types pass the caught error on as `reason`. A user's own "why" disappears. |

**LP002 coverage on Mongoose:** 26 throws create a new error inside a catch block. 13 pass the
caught error to CastError as its `reason` argument, and 1 uses `{ cause }`; LP002 correctly stays
silent on these 14. It reports the other 12.

## What round 1 told us

- **LP001:** comments and nesting are good signals for *lowering* severity. Tuning cost no true
  positive on Vite, and on Mongoose 4 of 4 lowered findings were indeed FP. But "empty catch
  without a comment" is still a weak reason for *high* severity.
  - On Mongoose, all 3 high findings are in documentation and build scripts.
  - On Vite, the 4 true positives share a stronger pattern: the expected failure is ruled out
    *before* the try (an existence check, an environment check), or a test assertion is
    swallowed.
- **LP002:** a `catch {}` without a variable (case A3) followed by a new, more specific error is
  usually a deliberate translation. Across both projects, A3 produced 2 TP out of 14 findings,
  yet it keeps severity high.
- **Mongoose is no longer unseen.** Any further tuning that uses what we learned here must be
  checked on a new held-out project.

## Round 2: high severity needs positive evidence

Designed on Vite and Mongoose, which were both tuning data by then. No finding is added or
removed; only severity and wording change.

**Principle:** high severity requires positive evidence that the swallowed or lost error matters.
Without such evidence a finding is medium, meaning "worth reviewing".

**LP001** levels. The first item that applies wins:

1. A swallowed test assertion (`expect.unreachable()`, `expect.fail()`, `assert.fail()`) →
   high/high.
2. A comment explaining the ignore → low/medium.
3. Inside another catch block whose error is still passed on → low.
4. **Positive evidence** → high. An existence check on the same thing runs before the risky
   code, in one of three shapes:
   - `if (exists(x)) { try { … } catch {} }`
   - `try { if (exists(x)) { … } } catch {}`, or the same try opening with `if (!exists(x)) return;`
   - `if (!exists(x)) return;` before the try

   What counts as a check:
   - functions whose name ends in `exists`/`Exists`, optionally followed by `Sync`;
   - `hasOwn`;
   - the methods `has`, `hasOwnProperty`, `isFile`, `isDirectory`;
   - the `in` operator.

   "The same thing" means a variable named in the check is used in the guarded code.
5. Otherwise → **medium** (this used to be high).

**LP002:** case A3 (no usable catch variable) → medium (this used to be high). The lower levels
from A1 and A4 still win.

**Wording:** medium explanations now end with a "review" sentence instead of reading like a
confirmed bug.

## Round 2 on the tuning data (not a precision claim)

Same labels as in the round-1 tables; only the levels moved. This shows that the change does what
it was designed to do on the code it was designed from. It does not estimate precision.

| | Vite, round 1 | Vite, round 2 | Mongoose, round 1 | Mongoose, round 2 |
|---|---|---|---|---|
| High severity: findings (TP) | 15 (5) | 4 (3) | 15 (1) | 0 (0) |
| Medium severity: findings (TP) | 0 (0) | 11 (2) | 0 (0) | 15 (1) |
| Low severity: findings (TP) | 18 (0) | 18 (0) | 4 (0) | 4 (0) |

Vite's 4 remaining high findings:

- `packages.ts:119` and `:150`: true positives, both with an existence check.
- `ssrLoadModule.spec.ts:288`: true positive, a swallowed assertion.
- `config.ts:2614`: LP002, debatable.

Vite's true positive `packages.ts:19` became medium: its check is an environment flag
(`process.versions.pnp`), not an existence check.

## Round 2 held-out: mature code (MongoDB Node.js driver)

**Choice.** Before anything was scanned, three popular Node.js backend libraries were cloned and
only their `try`/`catch` clauses were counted, to meet the "lots of try/catch" criterion:

| Library | try/catch clauses |
|---|---|
| node-postgres | 41 |
| knex | 181 |
| MongoDB Node.js driver | 681 |

The MongoDB driver was chosen. It is a different codebase, by a different team, from Mongoose.
knex and node-postgres were never scanned and are kept for a future held-out round.

**Scan.** 1,027 files, **288 findings (LP001: 275, LP002: 13)**, 4.0 s. No crashes, no warnings,
no files with parse errors.

**Vendored libraries: 258 findings, all FP, labelled as one group.**

- Every finding under `docs/` and `etc/docs/` is inside a third-party browser library carried by
  the documentation site. Checked by their file headers:
  - jQuery 1.8.3, 1.10.2, 2.0.3, 2.1.1 and 3.6.0 (30 copies);
  - ZeroClipboard (4 files);
  - the LiveReload client (1 file).
- They are not the driver's code: 257 are LP001 (185 medium, 72 low) and 1 is LP002 (medium).
- **This is the largest source of noise measured so far, and it comes from file selection, not
  from the rules.** At the time of round 2, LogPilot skipped only `node_modules`, `dist` and
  `.git`. Milestone 2 added default skips for minified and vendored files; see the
  [re-scan](#milestone-2-mongodb-driver-re-scan-with-default-excludes-not-a-precision-claim).

**Project code: 30 findings, all labelled one by one.** All 18 LP001 findings are in tests; none
is in `src/`. 10 of them were also labelled blind by a second labeller; see the
[second-labeller check](#second-labeller-check). The
"Pattern" letters are explained below the table.

| # | Location | Rule | Level | Label | Pattern | Reasoning |
|---|---|---|---|---|---|---|
| 1 | [src/client-side-encryption/providers/azure.ts:75](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/client-side-encryption/providers/azure.ts#L75) | LP002 | medium/medium | Debatable | I | Translates a failure to parse the KMS response as JSON into a domain error; the parse error, which can show what came back instead of JSON, is dropped. |
| 2 | [src/client-side-encryption/providers/azure.ts:167](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/client-side-encryption/providers/azure.ts#L167) | LP002 | low/medium | Debatable | J | Translates a recognised network-timeout error into a domain error and keeps its message; its stack and type are dropped. |
| 3 | [src/client-side-encryption/state_machine.ts:496](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/client-side-encryption/state_machine.ts#L496) | LP002 | low/medium | FP | H | The caught error is the internal timer's "timed out" signal, which carries no information; the new timeout error says the same and more. |
| 4 | [src/cmap/auth/mongodb_oidc/automated_callback_workflow.ts:81](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/cmap/auth/mongodb_oidc/automated_callback_workflow.ts#L81) | LP002 | low/medium | FP | H | Same as #3. |
| 5 | [src/cmap/auth/mongodb_oidc/human_callback_workflow.ts:134](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/cmap/auth/mongodb_oidc/human_callback_workflow.ts#L134) | LP002 | low/medium | FP | H | Same as #3. |
| 6 | [src/cmap/auth/scram.ts:252](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/cmap/auth/scram.ts#L252) | LP002 | high/medium | Debatable | K | A deliberate, commented translation: in FIPS mode the OpenSSL failure is replaced by a clearer message, but the `if` checks the environment, not the error, and the OpenSSL error is dropped. (Second labeller: FP; see check #1.) |
| 7 | [src/cmap/connection_pool.ts:366](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/cmap/connection_pool.ts#L366) | LP002 | low/medium | FP | H | Same as #3; the new error even carries a more informative error as its cause. |
| 8 | [src/collection.ts:338](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/collection.ts#L338) | LP002 | low/medium | Debatable | L | Translates a recognised validation error into a clearer one; only the internal stack is dropped. (Second labeller: FP, which looks more likely right; see check #2.) |
| 9 | [src/operations/execute_operation.ts:387](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/operations/execute_operation.ts#L387) | LP002 | low/medium | TP | M | In the retry loop, the failure that caused the retry is dropped and replaced by "server does not support retryable writes", although the same block takes care to preserve the original error elsewhere. |
| 10 | [src/sdam/topology.ts:664](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/src/sdam/topology.ts#L664) | LP002 | low/medium | FP | H | Same as #7. |
| 11 | [test/integration/change-streams/change_streams.prose.test.ts:91](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/change-streams/change_streams.prose.test.ts#L91) | LP001 | low/medium | FP | B | Test setup creating a collection that may already exist; the comment says that does not matter. |
| 12 | [test/integration/crud/bulk.test.ts:594](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/bulk.test.ts#L594) | LP001 | low/medium | TP | A | The try contains a test check that fails when no error is thrown (`test.ok(false)`); the empty catch swallows that failure too, so the test can never fail here. |
| 13 | [test/integration/crud/bulk.test.ts:884](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/bulk.test.ts#L884) | LP001 | low/medium | TP | A | Same as #12. |
| 14 | [test/integration/crud/bulk.test.ts:1760](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/bulk.test.ts#L1760) | LP001 | low/medium | FP | B | Same as #15. (Second labeller agrees.) |
| 15 | [test/integration/crud/crud.prose.test.ts:94](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/crud.prose.test.ts#L94) | LP001 | low/medium | FP | B | Test setup dropping a collection that may not exist ("don't care"). |
| 16 | [test/integration/crud/insert.test.ts:750](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/insert.test.ts#L750) | LP001 | low/medium | TP | A | Same as #12, with `test.fail(false)`. |
| 17 | [test/integration/crud/misc_cursors.test.ts:946](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/crud/misc_cursors.test.ts#L946) | LP001 | low/medium | TP | A | Same as #12. |
| 18 | [test/integration/node-specific/abort_signal.test.ts:288](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/node-specific/abort_signal.test.ts#L288) | LP001 | low/medium | FP | C | The test expects the aborted iteration to throw, ignores that error, and then checks which commands ran. (Second labeller agrees.) |
| 19 | [test/integration/sessions/sessions.test.ts:246](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/integration/sessions/sessions.test.ts#L246) | LP001 | low/medium | FP | B | Same as #15. |
| 20 | [test/mongodb_bundled.ts:8](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/mongodb_bundled.ts#L8) | LP002 | medium/high | TP | N | The test bootstrap keeps only the message of a module-load failure; the stack, which shows where loading failed, is dropped. (Second labeller agrees.) |
| 21 | [test/tools/runner/filters/crypt_shared_filter.ts:30](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/runner/filters/crypt_shared_filter.ts#L30) | LP001 | low/medium | FP | D | A test filter detecting an optional library; failing to load it means "not available". (Second labeller: Debatable, which looks more likely right; see check #6.) |
| 22 | [test/tools/spec-runner/index.js:394](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/spec-runner/index.js#L394) | LP001 | low/medium | Debatable | E | The test runner silently skips saving session data ("ignore"); an unexpected failure here would surface later as confusing errors in other steps. |
| 23 | [test/tools/unified-spec-runner/entities.ts:641](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/entities.ts#L641) | LP002 | low/medium | FP | H | Same as #3, in the test runner. |
| 24 | [test/tools/unified-spec-runner/operations.ts:228](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L228) | LP001 | low/medium | Debatable | F | Same as #25. (Second labeller: FP; see check #7.) |
| 25 | [test/tools/unified-spec-runner/operations.ts:234](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L234) | LP001 | medium/high | Debatable | F | The test runner tries each kind of entity in turn, but the try also wraps the close itself, so a real close failure ends up reported as "no closable entity". |
| 26 | [test/tools/unified-spec-runner/operations.ts:240](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L240) | LP001 | medium/high | Debatable | F | Same as #25, for the last attempt: a failed client close goes straight to the misleading "no closable entity" error. (Second labeller: FP; see check #8.) |
| 27 | [test/tools/unified-spec-runner/operations.ts:890](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L890) | LP001 | low/medium | FP | G | The test runner checks whether an entity has the expected kind; only the lookup is inside the try, and the comment names the expected error. |
| 28 | [test/tools/unified-spec-runner/operations.ts:901](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/tools/unified-spec-runner/operations.ts#L901) | LP001 | low/medium | FP | G | Same as #27. (Second labeller agrees.) |
| 29 | [test/unit/client-side-encryption/state_machine.test.ts:864](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/unit/client-side-encryption/state_machine.test.ts#L864) | LP001 | low/medium | FP | C | A unit test ignores an expected error and then checks the call arguments it is about. |
| 30 | [test/unit/client-side-encryption/state_machine.test.ts:886](https://github.com/mongodb/node-mongodb-native/blob/a255151d4d638cd4ffd807883d1b24f46d426278/test/unit/client-side-encryption/state_machine.test.ts#L886) | LP001 | low/medium | FP | C | Same as #29. (Second labeller agrees.) |

**Distinct patterns** in the driver.

| Pattern | Rule | Findings | Label | What it is |
|---|---|---|---|---|
| A | LP001 | 4 | TP | A test check that must fail (`test.ok(false)`, `test.fail(false)`) sits inside a try whose catch is empty |
| B | LP001 | 4 | FP | Test setup creates or drops a collection, "don't care" |
| C | LP001 | 3 | FP | A test ignores an expected error and checks something else afterwards |
| D | LP001 | 1 | FP | A test filter detects an optional library |
| E | LP001 | 1 | Debatable | The test runner silently skips saving session data |
| F | LP001 | 3 | Debatable | The test runner probes entity kinds, with the real operation inside the same try |
| G | LP001 | 2 | FP | The test runner probes entity kinds, lookup only |
| H | LP002 | 6 | FP | An internal "timed out" signal is replaced by a timeout error |
| I | LP002 | 1 | Debatable | A JSON parse failure is translated into a domain error |
| J | LP002 | 1 | Debatable | A network timeout is translated into a domain error, message kept |
| K | LP002 | 1 | Debatable | An OpenSSL failure in FIPS mode is translated into a clearer error (with a comment) |
| L | LP002 | 1 | Debatable | A recognised validation error is translated into a clearer one |
| M | LP002 | 1 | TP | A retry loop drops the failure that caused the retry |
| N | LP002 | 1 | TP | Test bootstrap keeps only the message of a module-load failure |
| V | both | 258 | FP | Vendored third-party browser libraries in the documentation site |

## Round 2 held-out: beginner code (3 Express/MERN apps)

**Selection protocol.** Written down before the search, and also saved as
[eval-data/protocols/beginner-selection-protocol.md](eval-data/protocols/beginner-selection-protocol.md)
(the raw search results are not published, because they list other people's repositories):

1. GitHub search for topic `mern-stack`, language JavaScript, most recently updated first, first
   50 results: `gh search repos --topic mern-stack --language JavaScript --sort updated --order
   desc --limit 50`. Run at 2026-11-09T20:53:42Z.
2. Walk the list in GitHub's order. Accept a repository only if all of these hold, checked on a
   shallow clone without running LogPilot:
   - (a) it is not a fork and not archived;
   - (b) it is the first repository from its owner;
   - (c) a `package.json` lists `express` in `dependencies`;
   - (d) it has 5–200 files that LogPilot would scan;
   - (e) it has at least one `try`/`catch`.
3. Stop at 3 accepted repositories.

| Result # | Repository | Outcome |
|---|---|---|
| 1 | App A | accepted: 100 scannable files, 182 try/catch |
| 2 | App B | accepted: 15 files, 10 try/catch |
| 3 | App C | skipped by rule (d): 242 scannable files |
| 4 | App D | accepted: 61 files, 25 try/catch |

**Results.** App A has 11 findings, all LP001. The other two have **0 findings, which is correct
for these rules**: none of their catch blocks is empty and none throws a new error.

What every catch block in the three apps does (its first statement):

| Catch block | App A | App B | App D |
|---|---|---|---|
| Sends an HTTP error response | 76 | 0 | 5 |
| Updates UI state or shows a toast | 56 | 2 | 8 |
| `console.log` / `console.error` | 29 | 8 | 9 |
| Empty (reported by LP001) | 11 | 0 | 0 |
| Other (rollback, `next(err)`, retry, return) | 10 | 0 | 3 |

Whether "log it to the console" or "send `err.message` to the client" keeps enough safe context is
a question for future rules (weak failure context, unsafe logging), not for LP001 or LP002.

App A, every finding:

| # | Location | Level | Label | Pattern | Reasoning |
|---|---|---|---|---|---|
| 1 | App A: backend/src/controllers/orderController.js:984 | low/medium | TP | Q | The "coupon not found" case is already handled without an exception, so only real failures reach this catch (a database error, a bug). The order then silently keeps a stale discount in a money calculation. The comment lowered the finding to low. |
| 2 | App A: backend/src/controllers/reportController.js:268 | medium/high | Debatable | R | If the tenant id cannot be converted, the financial report silently queries with the raw string and can show empty totals instead of an error. |
| 3 | App A: frontend/src/components/DashboardLayout.jsx:115 | medium/high | FP | P | Best-effort notification badge: one failing source just means fewer notifications. |
| 4 | App A: frontend/src/components/DashboardLayout.jsx:131 | medium/high | FP | P | Same as #3. |
| 5 | App A: frontend/src/components/DashboardLayout.jsx:136 | medium/high | FP | P | Same as #3, for the whole refresh. |
| 6 | App A: frontend/src/pages/KitchenDisplay.jsx:186 | low/medium | FP | P | The same notification code, copied into another screen, with a comment saying it is best effort. |
| 7 | App A: frontend/src/pages/KitchenDisplay.jsx:203 | low/medium | FP | P | Same as #6. |
| 8 | App A: frontend/src/pages/KitchenDisplay.jsx:209 | low/medium | FP | P | Same as #6. |
| 9 | App A: frontend/src/pages/WaiterScreen.jsx:173 | low/medium | FP | P | Same as #6, in a third screen. |
| 10 | App A: frontend/src/pages/WaiterScreen.jsx:190 | low/medium | FP | P | Same as #9. |
| 11 | App A: frontend/src/pages/WaiterScreen.jsx:196 | low/medium | FP | P | Same as #9. |

Patterns: **P** best-effort notification refresh, copy-pasted into 3 screens (9 findings, FP);
**Q** a coupon recalculation that keeps a stale discount on failure (1, TP); **R** a tenant id
conversion that falls back silently (1, debatable).

| | Findings | Distinct patterns | TP patterns |
|---|---|---|---|
| Mature, all findings | 288 | 15 | 3 |
| Mature, project code only | 30 | 14 | 3 |
| Beginner | 11 | 3 | 1 |

## What round 2 tells us

- **"High needs positive evidence" removes noise from high severity.**
  - On the tuning data, high-severity findings fell from 15 to 4 on Vite and from 15 to 0 on
    Mongoose.
  - On held-out code, only 1 of 299 findings is high.
  - But the 70% target cannot be shown: the existence-check evidence never fired on held-out
    code.
- **Severity does not yet match reality.** 6 of the 7 held-out true positives are low:
  - Comments next to swallowed test assertions ("should throw", "eslint-disable-line") and next to
    a silent fallback in a money calculation lowered real problems. **A comment shows intent, not
    harmlessness.**
  - The test-assertion rule knows only `expect.unreachable/expect.fail/assert.fail`; the driver's
    tests use `test.ok(false)` and `test.fail(false)` (4 true positives, all low).
  - LP002's case A4 (guarded translation) lowered the one clear LP002 bug: a retry that drops the
    original failure.
- **File selection is the biggest noise source on mature code.** 90% of the driver's findings
  were in vendored third-party libraries. Configuration that excludes folders addresses this
  directly; a default skip for vendored or minified files may be worth adding. (Milestone 2 added
  both; the re-scan below removes 257 of the 258 vendored findings.)
- **The current rules say little about beginner code.** Typical beginner error handling (log to
  the console, send the message to the client) is outside LP001 and LP002.
- **For the next round,** Vite, Mongoose, the MongoDB driver and the 3 apps are tuning data.
  knex and node-postgres are cloned, counted and unseen.

## Milestone 2: MongoDB driver re-scan with default excludes (not a precision claim)

**Why.** Milestone 2 made LogPilot skip minified files, files with a versioned `/*!` license
banner, and build/third-party folders by default (see the README section "What LogPilot does not
scan"), because 90% of the driver's round-2 findings were in copied libraries. Before
implementing this, its effect on the driver was predicted with a simulation. This re-scan checks
that prediction. **The rules did not change** (LP001 and LP002 are both rule version 1, the
round-2 behaviour), nothing was relabelled, and no new precision is claimed.

**Setup.** The same commit as round 2 (`a255151d4d638cd4ffd807883d1b24f46d426278`, clean working
tree), default settings, no config file, Node.js 22.23.4:

```bash
node <LogPilot>/dist/cli.js scan node-mongodb-native --format json --output mongodb-m2.json
```

**Predicted and actual numbers:**

| | Round 2 | Predicted | Actual |
|---|---|---|---|
| Files scanned | 1,027 | 737 | **737** |
| Files not scanned | not reported | 290 | **290** |
| ↳ minified by name (`*.min.js`) | | 64 | 64 |
| ↳ minified by content | | 211 | 211 |
| ↳ vendored (versioned `/*!` banner) | | 15 | 15 |
| Folders not scanned | not reported | `.git` | `.git` |
| Findings | 288 | 31 | **31** |
| ↳ LP001 | 275 | 18 | 18 |
| ↳ LP002 | 13 | 13 | 13 |
| Warnings | 0 | | 0 |

**The same findings, not just the same count.** Each of the 288 round-2 findings was matched by
file, line, column and rule:

- **257 are in files that are now skipped:** 116 in `*.min.js` files, 141 in files with a
  versioned banner.
- **The other 31 are reported again, at exactly the same places.** No finding is new, none
  disappeared, and their severities are unchanged (high 1, medium 5, low 25).
- The 31 are the 30 project-code findings labelled in round 2, plus the LP002 finding in
  `docs/js/livereload.js`. That file is a copied LiveReload client, neither minified nor
  bannered, so LogPilot cannot recognise it (a README limitation); an `exclude` pattern removes it.
  With the round-2 labels unchanged, 6 of the 31 are true positives. This is the same labelled data
  as before, not a new measurement.
- **The 211 files skipped as minified by content had no round-2 findings.** They are generated
  documentation assets: `main.js`, `search.js`, `navigation.js` and `icons.js` from the API docs of
  each driver version, plus `underscore-min.js` and `highlight.pack.js`. Skipping them changes no
  finding today, but they are no longer parsed, and future rules will not report inside them.
- **All 290 skipped files are under `docs/` or `etc/docs/`.** No file under `src/` or `test/` was
  skipped.

**Why the prediction matched exactly, despite a formula difference.** The simulation counted line
breaks when it averaged line lengths. LogPilot uses GitHub Linguist's exact formula: line breaks
not counted, rounded down to whole characters. The two can only disagree for a file whose average
is close to the 110-character threshold and that also has a line over 1,000 characters. Checked on
all 1,027 files:

- the two formulas give the same decision for every file;
- no file with such a long line has an average between 100 and 120 characters.

So the difference could not matter for this project.

**Time.** About 2.3 to 2.5 s for three runs, against 4.0 s in round 2. This is an observation on one
machine, not a controlled benchmark.
