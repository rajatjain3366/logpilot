# LogPilot

[![CI](https://github.com/rajatjain3366/logpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/rajatjain3366/logpilot/actions/workflows/ci.yml)

**If this code fails in production, will you have enough information to find out why?**

LogPilot is an open-source, local command-line tool that scans JavaScript and TypeScript
(Node.js) projects for code that would leave you **without evidence** when something goes
wrong in production, for example an error that is caught and then silently thrown away.

> **Status: early prototype, v0.5.0.** Three rules exist today: LP001, LP002 and LP003. LP003
> findings can show a proposed fix ([fix previews](#fix-previews)), and `logpilot fix` applies the
> fixes you approve, one question at a time ([Applying fixes](#applying-fixes-logpilot-fix)). The
> CLI is not published to npm yet; see [Quick start](#quick-start) for running it from this
> repository. Before relying on the results, read [Accuracy](#accuracy).

> **New in v0.5.0: `logpilot fix`.** It asks before every change, writes only files that git can
> restore exactly, and tells you how to undo. `scan` stays read-only.

> **Changed in v0.4.3: LP001 (`empty-catch`) is off by default.** Most empty catches on real
> projects were deliberate (see [LP001 in more detail](#lp001-in-more-detail)). **If your CI runs
> `--fail-on` and relied on LP001 findings to fail, it no longer fails on empty catches.** To keep
> the old behaviour, add `"rules": { "LP001": "on" }` to `logpilot.config.json`, or pass
> `--enable LP001`. Also new: findings with the same pattern are
> [listed together](#repeated-patterns).

Repository: https://github.com/rajatjain3366/logpilot

## The problem

When production code fails, you investigate with whatever the code left behind: logs,
error messages, stack traces. Some code patterns destroy that evidence before anyone sees it.
The most basic one is the **swallowed exception**:

```js
try {
  config = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {}   // the failure, and the reason for it, disappear here
```

A common one in Express apps is an error response that records nothing on the server:

```js
router.get("/users/:id", async (req, res) => {
  try {
    res.json(await User.findById(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Server error" }); // err is never logged or passed on
  }
});
```

LogPilot finds these patterns, explains why each one hurts a future investigation, and
suggests how to fix it.

## Principles

- **Local and private.** Runs on your machine. No account, no upload, no network needed to scan.
- **`scan` is read-only.** A scan never modifies your files. `logpilot fix` (see
  [Applying fixes](#applying-fixes-logpilot-fix)) changes a file only after you answer `y`, only
  files git can restore exactly, and always tells you how to undo the change.
- **Accurate over noisy.** Few, well-explained findings beat many weak warnings. A missing
  `console.log` is not automatically a problem.
- **Safe suggestions.** LogPilot never suggests logging secrets, tokens, credentials, payment
  data, or unnecessary personal data.

## Quick start

Requires **Node.js 22.20 or newer** (on Node 24: **24.8 or newer**), because exclude patterns use
Node's built-in glob matching, which became stable in those versions.

```bash
git clone https://github.com/rajatjain3366/logpilot.git
cd logpilot
npm ci              # install the exact dependency versions from package-lock.json
npm run build       # compile TypeScript (src/) to JavaScript (dist/)

node dist/cli.js scan path/to/your/project
```

Once LogPilot is published to npm, the same command will be `npx logpilot scan .`.

```text
logpilot scan [path] [options]   Scan a folder or a single file (default: the current folder)
logpilot fix [path] [options]    Show each LP003 fix and ask you; write a file only after you answer y
logpilot --help, -h              Show help
logpilot --version, -v           Show the version

Scan options:
  --config <file>          Use this config file instead of looking for logpilot.config.json
  --no-config              Do not use any config file
  --exclude <pattern>      Do not scan matching files or folders, e.g. "docs/**" (can be repeated;
                           adds to "exclude" in the config file)
  --enable <rule>          Turn on a rule that is off by default, e.g. --enable LP001 (can be
                           repeated; wins over "rules" in the config file)
  --show-skipped           List every file and folder that was not scanned, and why
  --no-default-excludes    Also scan build output, third-party folders, minified and vendored files
                           (node_modules and .git are never scanned)
  --min-severity <level>   Show only findings at or above low | medium | high (default: low)
  --fail-on <level>        Exit with 1 if a finding is at or above none | low | medium | high
                           (default: none, so findings alone never fail the scan)
  --format <text|json>     Report format (default: text). JSON includes warnings and skipped paths
  --output <file>          Write the report to this file instead of the terminal
  --fix-preview            Show a proposed fix (a diff) under each LP003 finding. A preview only:
                           LogPilot never changes your files
  --verbose                Show every finding in full (by default, findings with the same pattern
                           are listed under the first one, and later findings of the same kind
                           refer back to the first one)

Rules: LP001 empty-catch (off by default), LP002 lost-error-cause, LP003 unlogged-error-response.

Fix options: --config, --no-config, --exclude, --no-default-excludes (as for scan), and
  --output <file>          Write a JSON record of the run (what was written, declined, skipped)
```

## Example output

An LP003 finding (from `node dist/cli.js scan test/fixtures/positive/lp003-error-responses.js --no-config`;
the file has 8 findings, the first is shown. `--no-config` because this repository's own
`logpilot.config.json` excludes the test fixtures):

```text
lp003-error-responses.js:14:5
  LP003 unlogged-error-response | severity: high | confidence: high
  Evidence:
    14 |   } catch (err) {
    15 |     res.status(500).json({ message: "Server error" });
    16 |   }
  Why: This catch sends an error response (status 500) but never logs the error, passes it to
       next(err) or rethrows it. In production you will see that the request failed, but not why:
       the error message, stack trace and code are gone. Request loggers such as morgan, pino-http
       or express-winston record the request and its status code; their documentation describes no
       way to record an error the handler caught itself, and your error-handling middleware never
       sees it, because it is not passed to next(err).
  Fix: Log the error before responding, e.g. logger.error({ err, method: req.method, route:
       req.route?.path }, "Request failed") (pino) or console.error(err), or pass it on with
       next(err) so your error-handling middleware logs it and answers. Keep the client message
       generic (optionally with a request ID), and never log passwords, tokens, full request bodies
       or URLs (paths and query strings can carry tokens).

Scanned 1 file, 8 findings (LP003: 8)
LP001 (empty-catch) is off by default: most empty catches are deliberate. Turn it on with "rules": { "LP001": "on" } in logpilot.config.json, or --enable LP001.
```

An LP002 finding (from `node dist/cli.js scan test/fixtures/positive/lp002-options-mistake.ts --no-config`):

```text
lp002-options-mistake.ts:11:5
  LP002 lost-error-cause | severity: high | confidence: high
  Evidence:
    11 |     throw new Error("Failed to fetch profile", err);
  Why: This throw passes `err` (caught on line 10) as the second argument of `Error`. That argument
       is an options object, so `err` does not become the cause and is lost, together with its
       message, stack trace and properties such as `code`.
  Fix: Attach the caught error as the cause: throw new Error("Failed to fetch profile", { cause: err
       }). Node's console.error and util.inspect print the whole cause chain, so the original
       message, stack trace and code stay available. The cause is not included in JSON.stringify
       output or in error.stack, so on its own it does not expose internal details to API clients;
       decide what clients see in your error handler.
```

**Paths are relative to the folder you scan** (for a single file, to its folder), whichever folder
or drive you run LogPilot from: `scan D:\projects\shop` and `scan ../..` both print
`src/routes/users.js:14:5`. This holds for the text report, the JSON report and the diffs of
[fix previews](#fix-previews), whose `a/` and `b/` paths you can apply from the scanned folder.

### Repeated patterns

When several findings have the **same pattern** (same rule, case, levels and code shape: for LP002
the thrown class, for LP001 the first call in the `try`), the first is shown in full and the others
are listed under it by location. Every location is still printed. From
`node dist/cli.js scan test/fixtures/positive/lp002-message-only.js --no-config` (first finding
only; the file has 5 findings in 3 patterns):

```text
lp002-message-only.js:10:5
  LP002 lost-error-cause | severity: medium | confidence: high
  Evidence:
    10 |     throw new Error(`Failed to read settings: ${err.message}`);
  Why: This throw replaces `err` (caught on line 9) with a new error that keeps only part of it,
       ...
  Same pattern in 2 more places (throw new Error(...) that keeps only the caught error's text):
    lp002-message-only.js:18:5
    lp002-message-only.js:35:5
```

The summary counts patterns: `Scanned 1 file, 5 findings in 3 patterns (LP002: 5)`. `--verbose`
shows every finding in full. LP003 findings are never grouped: each one is a separate handler.
In JSON, each finding has a `pattern` ID (see [JSON output](#json-output)).

**Concise by default.** The first finding of each rule and kind gets the full "Why" and "Fix".
Later findings of the same kind get one line instead, such as
`Why and fix: same as for line 14 above.`, plus any sentence of the fix that is new for them (for
example LP002's rewritten `throw`). The evidence and any proposed fix are always shown in full.
`--verbose` repeats the full text for every finding; the JSON report always has the full text.

**Line width.** In a terminal, text is wrapped to the terminal's width (at least 60 and at most 100
columns), so words are not cut in the middle. Piped or written to a file, it is wrapped at 100
columns. Code (evidence and diffs) is never wrapped.

The report goes to **stdout** (or to the `--output` file); errors and warnings go to **stderr**.
A file with syntax errors is still scanned as far as possible, and LogPilot warns about it
(`Warning: x.js: 1 syntax error (first at line 1: Expression expected.); findings in this file may be incomplete`)
and counts such files in the summary. Warnings do not change the exit code.

## Fix previews

`--fix-preview` shows a proposed fix under each LP003 finding, as a diff. **It is only a preview:
`scan` never changes your files.** Review the fix and apply it yourself, or let
[`logpilot fix`](#applying-fixes-logpilot-fix) apply the ones you approve. With `--format json`,
each finding carries the fix as exact text edits (see [JSON output](#json-output)).

From `node dist/cli.js scan test/fixtures/fix/loggers/pino-in-file.js --fix-preview --no-config`
(the file creates a pino logger, so the fix uses it; the "Why" and "Fix" lines are left out here):

```text
  Proposed fix (preview only, not applied): Log the caught error with logger.error just before the
    error response on line 13.
    Logger: logger.error (confidence high: this file creates `logger` with pino)
    --- a/pino-in-file.js
    +++ b/pino-in-file.js
    @@ -10,6 +10,7 @@
       try {
         res.json(await loadOrder(req.params.id));
       } catch (error) {
    +    logger.error({ err: error, method: req.method, route: req.route?.path }, "Request failed");
         res.status(500).json({ message: "Could not load the order" });
       }
     });
  Checked: the fixed code parses, the fix only adds code, it logs nothing but the error, req.method
           and req.route?.path, and after it this finding is gone and no other finding changes.

Scanned 1 file, 1 finding (LP003: 1)
LP001 (empty-catch) is off by default: most empty catches are deliberate. Turn it on with "rules": { "LP001": "on" } in logpilot.config.json, or --enable LP001.
Fix previews (LP003 only): 1 available, 0 not available.
No file was changed: apply a fix yourself after reviewing it.
```

**What a fix adds:** one log line with the whole error object, under the catch's own variable
name. With `console.error` and pino, that keeps the error's message, stack trace, `code` and
`cause`; with winston and bunyan, everything but the cause (see below). A `catch {}` gets a
variable: `catch (err)`, or another name if `err` is already used in the block.

- **The response is never changed.** If the error's message is sent to the client, or a failure
  answers 200 OK, the fix keeps that and adds a note: changing it changes what clients receive.
- **Context: only `req.method` and `req.route?.path`.** `req.route.path` is the route *pattern*,
  such as `/users/:id`, never the values in the URL. A fix never logs the request body, headers,
  cookies, query string, `req.path`, `req.originalUrl` or `req.params`: paths and query strings can
  carry tokens (password-reset links, `?access_token=`, API keys).
- **Where:** just before the one statement that sends a 5xx response, so failures answered on
  purpose with a 4xx are not logged. Otherwise at the start of the catch block (the fix then says
  that it also logs those).
- **Style:** the same indentation (tabs or spaces), line ending (LF or CRLF), quotes and
  semicolons as the file.
- **A catch that already logs a message without the error** (`console.log("Login failed")`) gets
  the error added to that call (`console.log("Login failed", err)`) instead of a second log line.
  This is done only for `console`, when it is the only log call in the catch.

**Which logger the fix uses.** The first of these that applies:

| What LogPilot finds | The fix writes | Logger confidence |
|---|---|---|
| The file creates a pino logger at its top level (`const logger = pino()`) | `logger.error({ err, method: req.method, route: req.route?.path }, "Request failed")` | high |
| The file creates a winston logger | ``logger.error(`Request failed: ${req.method} ${req.route?.path}`, err)`` | medium |
| The file creates a bunyan logger (a `.child()` logger is preferred over its parent) | ``log.error(err, `Request failed: ${req.method} ${req.route?.path}`)`` | medium |
| The file imports a logger from a relative module (`require("./utils/logger")`), and that module creates it with pino, winston or bunyan. LogPilot reads that one module, and no further, and only if it is inside the folder you scan (like the scan itself, it never reads outside that folder or follows symbolic links) | that library's form | medium |
| The file imports a logger it cannot identify (`logger`, `log`, `appLogger`, ...) and already logs a caught error with `logger.error(...)` | a copy of that call's form | medium |
| None of these | `console.error("Request failed:", { method: req.method, route: req.route?.path }, err)` | low |

Each form was chosen by running the real libraries (pino 10, winston 3.19, bunyan 1.8) and
checking what reached the log:

- **pino** keeps the error's message, stack trace, `code` and `cause` only under the key `err`
  (under `error`, the message and stack are lost).
- **winston** loses the message and stack when the error is inside the metadata object
  (`logger.error("msg", { err })`), so the fix passes it as its own argument. The cause's message
  is not kept, and a custom format that prints only the message drops the stack; the fix says so.
- **bunyan** keeps them when the error comes first. The cause is not kept; the fix says so.
- **pino-http's `req.log` is never used.** By default it adds the whole request to every line,
  including the `Authorization` header and the query string.

**Before a fix is shown, LogPilot checks it in memory:**

- the fix only adds code;
- the fixed file parses;
- the added code uses nothing but the error, `req.method`, `req.route?.path` and the logger's
  `error` method;
- when all rules run again, this finding is gone and nothing else changed, including what
  `logpilot-ignore` comments hide.

A fix that fails a check is not shown, and LogPilot warns about it (a LogPilot bug: please report
it).

**A note when the `try` block saves a password-like field** (v0.4.1). Logging the whole error is
risky in code that saves a password: a validation error can keep the value that failed. With
Mongoose, `errors.password.value` holds the plain password, and `console.error` and pino both print
it. So such a fix gets a note, for example:

> This try block saves `password` (line 101). If that field fails validation, the validation error
> can keep its value (Mongoose keeps it in `errors.password.value`), and logging the whole error
> writes it to your logs. Check the value before saving (for example its length), or redact it in
> your logger.

The fix is still shown: the value is only in the error when that field itself fails validation,
which many handlers rule out by checking it first.

- **"Password-like"** means a name with one of these whole words (camelCase, snake_case and
  kebab-case are split into words): `password`, `passwd`, `pwd`, `passphrase`, `pass`, `secret`,
  `token`, `otp`, `pin`, `cvv`, `cvc`; or the word pairs `api key`, `private key`, `access key`,
  `secret key`, `card number`. So `newPassword`, `password_confirmation`, `x-api-key`,
  `refreshToken` and `cardNumber` count; `secretary`, `spinner`, `isPinned` and `bypass` do not.
  Some names count although they hold no secret, such as `passwordChangedAt` (a date), `pinCode`
  (a postal PIN code), `passThrough` (a flag) and `tokenCount`. The note names the field, so you
  can see that.
- **"Saves"** means, in the `try` block:
  - a password-like key in an object passed to `new X(...)` or to a write call (`create`,
    `insert…`, `save`, `update…`, `findOneAndUpdate`, `findByIdAndUpdate`, `replaceOne`, `upsert`,
    `build`, `bulkCreate`, `set`), at any depth: `User.create({ password })`,
    `findByIdAndUpdate(id, { $set: { apiKey } })`;
  - `user.password = ...`, when the same `user` is saved in that `try` block (`user.save()`);
  - the whole request body (`User.create(req.body)`, `new User({ ...req.body })`), only when the
    model's schema shows a password-like field. LogPilot reads the model's module one step, with
    the same rules as for loggers. **Models from packages, or from outside the folder you scan, are
    not checked**, so saving the request body with them gets no note.
- **No note** for reading a password (`bcrypt.compare(password, user.password)`), for a token in
  the response (`res.json({ token })`), or for error middleware (there is no `try` block to look
  at).

**On the apps LP003 was tuned on** (tuning data, not a quality claim; see
[docs/evaluation.md](docs/evaluation.md#milestone-3-lp003-fix-previews-on-the-tuning-apps)):

- With v0.4.0, 107 of 112 LP003 findings got a fix. All 107 passed these checks and added only one
  line (plus a catch variable in 21), and the other 5 were 4xx answers. No project there used a
  logger LogPilot recognises, so every fix used `console.error`.
- v0.4.1 no longer scans one app's compiled copies in `.server-build/`, so 99 of 104 findings get a
  fix. 5 of those fixes carry the password note: all are handlers that create or change a password.
  All 5 already check the password's length before saving, so there the note is a reminder.

**No fix is proposed** (the report says why) for:

- a catch that only answers 4xx (case E): telling expected failures from unexpected ones needs a
  human;
- a `try` block that calls axios: axios errors contain the request's headers, including
  `Authorization`, so logging the whole error would write credentials to your logs. When the file
  imports axios but the `try` does not call it, the fix comes with a note;
- `catch ({ message })`, where the whole error is not available;
- error middleware written as an arrow function without braces;
- files with syntax errors, and code where a local variable named like the request or `console`
  would change what the log line means;
- LP001 and LP002 findings. An empty catch needs a human decision; for LP002, ESLint's
  `preserve-caught-error` offers a fix in your editor.

## Applying fixes (`logpilot fix`)

> **New in v0.5.0.** Tried by hand in Git Bash (with `node` and `node.exe`), VS Code's terminal and
> PowerShell on Windows, and measured on copies of 7 real apps (99 of 99 fixes applied; see
> [docs/evaluation.md](docs/evaluation.md#milestone-4-logpilot-fix-on-copies-of-the-tuning-apps)).

`logpilot fix [path]` shows each LP003 fix that `--fix-preview` would show, **asks you**, and writes
a file only after you answer `y`:

```text
[1/3] src/routes/users.js:6:5  LP003 unlogged-error-response (severity high, confidence high)
  Log the caught error with console.error just before the error response on line 7.
    --- a/src/routes/users.js
    ...
Apply this fix?  y = yes   n = no   s = skip the rest of this file   q = quit   ? = help
>
```

- **Answers:** `y` (yes), `n` (no), `s` (skip the rest of this file), `q` (quit), `?` (help).
  Enter alone does nothing. There is no "yes to everything" option.
- **One write per file:** your answers for a file are collected first; then all the fixes you
  accepted for it are checked together and written at once.
- **Stopping:** `q` or Ctrl+C at a question stops at once. Files already written stay written;
  fixes you accepted in the current file are not written. Ctrl+C while a file is being written
  stops right after that file is complete. Keys you press during a write are ignored (they never
  answer a question), and LogPilot says so.
- **What it says at the end is what happened:** the files it wrote, and the git commands to see
  and undo the changes (`git diff -- "<file>"`, `git checkout -- "<file>"`), or "Nothing was
  written." Then: run your tests.

**Before it asks about a file**, the file must be: in a git repository, tracked by git, with no
uncommitted changes (commit or stash first), inside the folder you gave, not reached through a
symbolic link or junction, without a second name (hard link), not read-only, valid UTF-8, and
**restorable byte for byte by git**. (With `core.autocrlf=true`, a file with LF or mixed line
endings is "clean" for git but would come back with CRLF, so it is not offered.) A file that fails
a check is listed with the reason and not asked about.

**How it writes:** to a temporary file next to the original, flushed to disk, then renamed over the
original in one step, so a crash never leaves half a file. A file another program has open is tried
again for up to 2 seconds. Then LogPilot reads the file back and checks it again: it parses, the
fixed findings are gone, and nothing else changed.

- If LogPilot's own bytes fail that check (a LogPilot bug), it writes the original back and checks
  that too.
- If the file on disk is **not** what LogPilot wrote (another program changed it in that moment),
  it writes nothing back, so that change is not lost, stops with exit code 2, and shows you the git
  commands.

**It needs a terminal.** With input or output piped or redirected (`|`, `<`, `>`), it stops at once
with exit code 2 and changes nothing. In Git Bash, run it directly in the window (`node` or
`node.exe` both work); do not pipe it.

`--output <file>` writes a JSON record of the run: what was offered, applied, declined, skipped or
not written and why, each file's SHA-256 before and after, and the undo commands.

| Exit code | Meaning |
|---|---|
| 0 | Finished: every fix you accepted was written and checked (also when you accepted none, or quit with `q`) |
| 1 | At least one fix you accepted was not written (the file changed, was locked, or failed the check and was put back) |
| 2 | It could not run (no terminal, not a git repository, bad arguments), or it stopped because a file needs you |
| 130 | Stopped by Ctrl+C |

## Rules

| Rule | Name | Detects | Severity | Confidence |
|---|---|---|---|---|
| `LP001` | `empty-catch` | **Off by default** (turn it on with `--enable LP001` or `"rules": { "LP001": "on" }`). A `catch` block with no statements: `catch (e) {}`, `catch {}`. Worth reviewing | medium | high |
| | | …and an existence check on the same thing runs first (`if (existsSync(f)) { try { read(f) } catch {} }`, also `map.has(k)`, `k in obj`, `stat(p).isFile()`, or an early `if (!existsSync(f)) return;`), so only *unexpected* errors can reach the catch | high | unchanged |
| | | …and a comment explains the ignore: inside the catch, inside the try, on the line(s) directly above the `try`, or right after the catch's `}` | unchanged | medium |
| | | …inside another `catch` whose own error is still thrown, returned or passed on (best-effort work while handling that error) | low | unchanged |
| | | …around a test assertion that fails by throwing, so the test can never fail there (this overrides all rows above). See [LP001 in more detail](#lp001-in-more-detail) | high | high |
| `LP002` | `lost-error-cause` | A `catch` block throws a new error that drops the caught one: `catch (err) { throw new Error("Load failed") }` | high | high |
| | | The new error keeps only the caught error's text: ``new Error(`Load failed: ${err.message}`)``, `"x: " + err`, `String(err)`, `new Error(err)` | medium | high |
| | | The caught error is passed as `Error`'s 2nd argument, which is an options object, so it is lost: `new Error("Load failed", err)` | high | high |
| `LP003` | `unlogged-error-response` | An Express handler's `catch` (or error middleware) sends an error response, and the caught error is never logged, passed to `next()` or rethrown. See [LP003 in more detail](#lp003-in-more-detail) | high, or low for a 4xx answer | high or medium |

- **Severity** = how much the problem would hurt a failure investigation, and how much evidence
  there is for that:
  - *high*: positive evidence that the lost error matters;
  - *medium*: worth reviewing, the default when there is no such evidence;
  - *low*: probably deliberate or minor.
- **Confidence** = how sure LogPilot is that it is a real problem and not a deliberate,
  harmless choice. A comment next to an empty catch suggests the author ignored the error on
  purpose, so LP001 lowers the confidence to *medium*.
  - **A comment does not lower the severity.** Real bugs have been found next to comments such as
    "should throw" or "pg may not be installed": a comment shows intent, not harmlessness.

Files scanned: `.js .jsx .ts .tsx .mjs .cjs .mts .cts`. Some folders and files are skipped by
default; see [What LogPilot does not scan](#what-logpilot-does-not-scan).

### LP001 in more detail

> **LP001 is no longer being developed, and we recommend ESLint's
> [`no-empty`](https://eslint.org/docs/latest/rules/no-empty) instead.** On code it was not tuned
> on, **3 of LP001's 25 findings were real problems (12%)**, and severity did not separate them
> from the rest (see [Accuracy](#accuracy)). `no-empty` reports the same empty catch blocks, in
> your editor. LP001 stays in LogPilot as it is.
>
> **Since v0.4.3, LP001 is off by default.** Early testers judged all 6 of their LP001 findings
> to be deliberate. Turn it on with `--enable LP001` or `"rules": { "LP001": "on" }` in
> `logpilot.config.json`. While it is off, the summary says so once:
> `LP001 (empty-catch) is off by default: most empty catches are deliberate. Turn it on with ...`.
> Its rule version went from 2 to 3 in v0.4.3 because its suggestion text changed (v0.4.2);
> what it detects has not changed since version 2.

For LP001, an outer error that is passed on wins over an existence check; a comment does not.

A comment counts only if it ends its line: annotations inside code, such as
`require(/* #__KEEP__ */ "x")`, are meant for other tools and do not count as explanations.
Neither do **tool directives**, even with a description after them: comments that start with
`eslint-…` (such as `eslint-disable-next-line no-empty`), `@ts-ignore`, `@ts-expect-error`,
`@ts-nocheck`, `istanbul ignore`, `c8 ignore`, `v8 ignore`, `prettier-ignore`, `biome-ignore` or
`logpilot-ignore`.

**Test assertions that fail by throwing,** recognised inside the `try` of an empty catch:

| Calls | Counted when |
|---|---|
| `expect.unreachable()`, `expect.fail()`, `assert.fail()`, `chai.expect.fail()`, `chai.assert.fail()` | always |
| `assert(false)`, `assert.ok(false)` | the first argument is the literal `false` |
| `t.fail()`, `test.fail()`, `t.ok(false)`, `test.ok(false)` | `t` or `test` is **not** a parameter of an enclosing function, e.g. `import { assert as test } from "./shared"` |

In tap, tape and AVA, `t` is the test context passed to the test function
(`test("x", (t) => { ... })`). There, an empty catch does not hide a failed `t.fail()`: tap's
assertions do not throw, and AVA documents that catching a failed assertion does not make the
test pass. So those calls get the default severity.

A `catch` block that does anything (logs the error, calls a logger such as pino or winston,
rethrows, or returns a fallback value) is **not** reported by LP001.

### LP002 in more detail

LP002 checks every `throw new SomeError(...)` (and `throw Error(...)` without `new`) that
leaves a `catch` block directly. The fix is to attach the caught error as the **cause**:
`throw new Error("Load failed", { cause: err })` (Node.js 16.9+; TypeScript needs `target`
or `lib` ES2022 or newer). Node's `console.error` and `util.inspect` then print the whole
chain. A cause is not included in `JSON.stringify` output or in `error.stack`, so attaching
it does not by itself expose internal details to API clients.

LP002 reports more softly when the code suggests the choice may be deliberate:

| Case | Example | Severity | Confidence |
|---|---|---|---|
| A1: the caught error is logged right before the throw | `logger.error({ err }, "sync failed"); throw new Error("Sync failed")` | low | medium |
| A2: a comment in the catch block | `// don't leak database details to clients` | unchanged | medium |
| A3: no usable error variable (often a deliberate translation into a clearer error) | `catch {}`, `catch ({ message })`, `catch (_err)` | medium | medium |
| A4: the throw is under an `if`/`switch` that checks the caught error | `if (err.code === "ENOENT") throw new NotFoundError(path)` | low | medium |

**Not reported by LP002:** `{ cause: err }` and the shorthand `catch (cause) { ... { cause } }`;
`throw err`; your own error classes receiving the whole error (`new AppError("msg", err)`,
`new AppError({ cause: err })`, `new AggregateError([err], "msg")`); a built-in error whose
options are a variable (`new Error("msg", options)`), because LogPilot cannot see inside it;
throws inside callbacks or nested functions; and throws caught by an inner `try`.

See also [What LP002 will miss](#what-lp002-will-miss) and
[Where LP002 may be wrong](#where-lp002-may-be-wrong).

### LP003 in more detail

LP003 looks at Express request handling: a `catch` that answers the client with an error, while
the error itself is never recorded. In production you then see "500" and nothing else (see the
second example under [The problem](#the-problem)).

**Which functions are Express handlers:**

- **Registered in the same file:** functions passed to `app` or `router` `.get/.post/.put/.patch/.delete/.all/.options/.head/.use(...)`
  or `app.route(path).get(...)`, where the app or router comes from `express()`,
  `express.Router()` or `Router()` in that file. One wrapper call such as `asyncHandler(fn)`,
  arrays of handlers, and same-file functions passed by name are followed.
- **By shape (confidence medium):** any function whose response parameter is named `res` or
  `response` and that calls `res.status/json/send/sendStatus/end/render/redirect`. This is how
  controllers in their own files are recognised, because LogPilot reads one file at a time.
- **Error middleware:** the four-parameter `(err, req, res, next)` form. It is checked as a whole:
  it receives every error passed on with `next(err)`.

**No Express handler at all?** Then LP003 and fix previews had nothing to check, and the summary
says so once: `No Express handlers found: LP003 and fix previews only check Express apps.` (in
JSON, `summary.filesWithExpressHandlers` is `0`). This is common in Next.js apps and libraries:
0 LP003 findings there does not mean the error responses are fine.

**The error counts as kept** (no finding) when it is passed to any function: a logger,
`console.error`, `Sentry.captureException`, `next(err)`, or your own helper. LogPilot cannot see
inside helpers from other files, so it assumes they handle the error. It also counts as kept when
it is thrown, returned, or stored somewhere (`res.locals.error = err`). Using it only in a
condition (`if (err.code === 11000)`) or only in the response does not count.

**Response helpers in the same file** count as responses: `errorResponse(res, 502, "...")`, where
`errorResponse` calls `res.status(...)`. LP003 looks one level into such a helper. If the helper
logs the error, the error is kept.

| Case | Example in the catch | Severity | Confidence |
|---|---|---|---|
| A: error response (5xx, or a status LogPilot cannot read), error never used | `res.status(500).json({ message: "Server error" })` | high | high if registered in the file; medium if recognised by shape only |
| B: the error only goes to the client | `res.status(500).json({ error: err.message })` | high | same as A |
| C: a log line without the error | `console.log("error"); res.status(500).send("Failed")` | high | same as A |
| D: no error status, so the failure goes out as 200 OK | `res.json({ success: false })` | high | medium |
| E: a 4xx response, error never logged | `res.status(400).json({ message: "Invalid data" })` | low | medium |

A request logger does not change this. morgan, pino-http and express-winston record the request
and its status code; their documentation describes no way to record an error the handler caught
itself. express-winston's `errorLogger`, and your own error middleware, only see errors passed on
with `next(err)`.

How often LP003's findings were real problems on apps it was not designed on is in
[Accuracy](#accuracy).

## Accuracy

The numbers below come from running LogPilot on real open-source projects that played no part in
designing the rule being measured, and reading every finding. A finding counts as a **real
problem** only when a failure there would really lose evidence that matters; findings that are
debatable count as not real. The samples are small, so treat the percentages as rough.

| Rule | Measured on | Findings | Real problems | Real problems at high severity |
|---|---|---|---|---|
| LP003 `unlogged-error-response` | 12 small Express/MERN apps | 43 | 30 (70%) | 30 of 33 (91%) |
| LP002 `lost-error-cause` | the MongoDB Node.js driver (its own code) and 3 small Express/MERN apps | 12 (all in the driver) | 2 (17%) | 1 high finding, not a real problem |
| LP001 `empty-catch` | knex and node-postgres | 25 | 3 (12%) | no high findings |

What this means:

- **LP003's high-severity findings were nearly all real problems.**
  - Its 4xx case (case E) found no real problem: all 10 were debatable authentication or
    validation answers, where a 401 or 400 is the right answer to the expected failure. They were
    measured at *medium* severity. LP003 now reports case E at *low*; that new level has not been
    measured.
  - One app gave 17 of the 30 real problems, all one repeated pattern. Counted by distinct
    pattern, 6 of 16 were real problems, so expect fewer elsewhere.
- **Most LP001 and LP002 findings are not real problems, and severity does not yet separate the
  real ones.**
  - LP001's 3 real problems were reported at *medium*, but so were 21 of the 22 findings that were
    not.
  - In an earlier measurement (LP001's first version, and LP002), 6 of the 7 real problems were
    reported at *low*, mostly because a nearby comment lowered them. A comment no longer lowers
    LP001's severity.
- **What gets scanned matters as much as the rules.** With everything scanned, the MongoDB driver
  gave 288 findings, of which 6 (2%) were real problems: 258 of them (90%) were inside copies of
  third-party libraries in its documentation site. LogPilot now skips such files by default (see
  [What LogPilot does not scan](#what-logpilot-does-not-scan)).
- **Who checked the findings.** Each finding was labelled against a written guide, by one reviewer
  (an AI assistant). The maintainer independently labelled two samples of 10 without seeing those
  labels:
  - LP001 and LP002 on the MongoDB driver: the same "real problem or not" decision for all 10.
  - LP003: the same decision for all 8 at high severity; both case E findings, which the reviewer
    had called debatable, the maintainer called real problems. High-severity precision is the same
    either way.

The full method, every labelled finding, and scripts that recompute these numbers are in
[docs/evaluation.md](docs/evaluation.md) and [docs/eval-data/](docs/eval-data/README.md). Small
student apps are anonymized there (App A to App T).

## Configuration

Put a `logpilot.config.json` in your project:

```json
{
  "exclude": ["docs/**", "scripts/**"],
  "defaultExcludes": true,
  "minSeverity": "low",
  "failOn": "none",
  "rules": { "LP001": "on" }
}
```

| Setting | Meaning | Default |
|---|---|---|
| `exclude` | Glob patterns of files and folders not to scan, relative to the config file's folder | `[]` |
| `defaultExcludes` | Skip the default folders, minified and vendored files listed [below](#what-logpilot-does-not-scan) | `true` |
| `minSeverity` | Show only findings at or above `low`, `medium` or `high` (see [Choosing what to show, and when to fail](#choosing-what-to-show-and-when-to-fail)) | `"low"` |
| `failOn` | Exit with code 1 when a shown finding is at or above `none`, `low`, `medium` or `high` | `"none"` |
| `rules` | Turn rules `"on"` or `"off"` by ID, for example `{ "LP001": "on" }`. Rules you do not name keep their default: LP001 off, LP002 and LP003 on. `--enable <rule>` wins over this setting | `{}` |

- **Where LogPilot finds it:**
  - It looks in the scanned folder, then in each parent folder up to the repository root (the
    first folder with `.git`), and uses the nearest file. It never looks above the repository root.
  - Outside a git repository, it checks only the scanned folder.
  - The summary names the file it used (`Config file: logpilot.config.json`).
  - `--config <file>` uses a specific file; `--no-config` uses none.
- **Command-line options win** over the file. `--exclude` adds patterns to the file's `exclude`
  list.
- **Patterns:**
  - `docs/**` skips the whole `docs` folder.
  - `*` stays inside one folder, so use `**/` to match at any depth (`**/*.generated.js`).
  - Folders whose names start with a dot (like `.github`) only match when the pattern names them.
  - Patterns starting with `!`, absolute paths and `\` are not allowed.
  - A pattern that matches nothing gives a warning, which usually means a typo.
- **An invalid config file stops the scan** with exit code 2 and a message naming the problem:
  invalid JSON, an unknown setting such as `"excludes"`, or a wrong value.

### What LogPilot does not scan

Scanning the wrong files was the biggest source of noise we measured: 90% of the MongoDB driver's
findings were inside copies of jQuery in its documentation site. So LogPilot skips these by
default:

| Skipped | Why |
|---|---|
| Folders `node_modules`, `.git` | dependencies and git internals: **never scanned**, even with `--no-default-excludes` |
| Folders `vendor`, `bower_components`, `jspm_packages` | third-party code |
| Folders `dist`, `build`, `coverage`, `.next`, `.nuxt`, `.output`, `.svelte-kit` | generated output |
| Folders `.angular`, `.astro`, `.aws-sam`, `.cache`, `.docusaurus`, `.esbuild`, `.expo`, `.firebase`, `.netlify`, `.nx`, `.parcel-cache`, `.serverless`, `.turbo`, `.vercel`, `.vinxi`, `.vite`, `.webpack`, `.wrangler` | generated output: tools' build and cache folders (v0.4.1) |
| Folder `.yarn` | third-party code: Yarn's own release and plugins (v0.4.1) |
| Any other folder whose name starts with `.` and whose last word is `build`, `dist`, `out`, `output` or `cache`, such as `.server-build`, `.build` or `.remix-cache` | generated output: a dot-named build folder (v0.4.1) |
| Files `*.min.js`, `*.min.mjs`, `*.min.cjs` | minified |
| Files whose lines average more than 110 characters **and** that have a line over 1,000 characters | minified (the average rule is GitHub Linguist's; the long-line check keeps files of long strings) |
| Files that start with a `/*!` license comment that names a version, like `/*! jQuery v1.10.2 */` | a copied third-party library (projects' own `/*!` banners usually have no version, so they are still scanned) |
| `.d.ts` files | type declarations only |

`docs/`, `public/` and test folders **are** scanned: they can hold your own code.

The summary always says what was not scanned, for example
`Not scanned: 290 files and 1 folder (default folders: 1, minified: 275, vendored: 15).`
Run with `--show-skipped` to list every skipped path with its reason, and with
`--no-default-excludes` (or `"defaultExcludes": false`) to scan everything except `node_modules`
and `.git`.

## Suppressing a finding

When you have reviewed a finding and decided the code is fine, hide it with a comment that names
the rule and gives the reason after `--`:

```js
try {
  cache = JSON.parse(readFileSync(cachePath, "utf8"));
} catch {} // logpilot-ignore-line LP001 -- the cache is optional; it is rebuilt when missing

try {
  settings = loadSettings(file);
} catch (err) {
  // logpilot-ignore-next-line LP002 -- the public API documents only NotConfiguredError
  throw new NotConfiguredError("No settings file found");
}
```

- `logpilot-ignore-line` hides findings on the line where the comment starts;
  `logpilot-ignore-next-line` hides findings on the line after the comment. "The line" is the one
  in the report's `file:line:column`: the `catch` keyword for LP001, the `throw` for LP002, and
  the `catch` keyword (or the first line of the error middleware) for LP003.
- The comment must **start** with the directive. `/* ... */` comments work too, also `{/* ... */}`
  in JSX.
- Name one or more rules (`LP001, LP002`). There is no "ignore everything" form.
- **A reason is required.** A suppression without `-- reason` is not applied, and LogPilot warns
  about it.
- LogPilot also warns when a suppression names no rule or an unknown rule, and when it matches no
  finding (for example after the code was fixed), so outdated suppressions do not pile up.
  Warnings never change the exit code.
- A suppression for a rule that is turned off (such as LP001 by default) gets no "matched no
  finding" warning: that rule did not run, so it could not have matched anything.
- The summary counts suppressed findings (`1 finding was suppressed by logpilot-ignore comments.`).
  The JSON report lists each one with its reason.

## Choosing what to show, and when to fail

- `--min-severity medium` hides *low* findings. The summary says how many were hidden:
  `1 finding below medium severity is not shown (--min-severity).`
- `--fail-on <level>` makes LogPilot exit with code 1 when a shown finding is at or above that
  level, for example to stop a CI job.
- **By default, findings never fail a scan (`--fail-on none`): LogPilot is warning-only.** This
  changed in v0.2.0: v0.1.0 exited with code 1 whenever there was a finding. Use `--fail-on low`
  for the old behaviour.
- **Only rules that run can fail a scan.** Since v0.4.3, LP001 is off by default, so empty catches
  no longer fail `--fail-on` unless you turn LP001 on (`--enable LP001` or
  `"rules": { "LP001": "on" }`).
- A `--fail-on` level below `--min-severity` (for example `--min-severity high --fail-on medium`)
  is refused with exit code 2, because LogPilot would fail on findings it does not show.
- Both can be set in the config file (`minSeverity`, `failOn`); command-line options win.

> **Severity is not reliable yet.** On code LogPilot was not tuned on, real problems got the same
> severity as most findings that were not real problems (see [Accuracy](#accuracy)). Review
> findings of every severity before relying on `--fail-on`, and do not use `--min-severity` to
> hide findings you have never looked at.

## JSON output

`--format json` prints the report as JSON, for other tools to read. `--output <file>` writes the
report (JSON or text) to a file instead of the terminal:

```bash
node dist/cli.js scan . --format json --output logpilot-report.json
```

LogPilot refuses an `--output` file that ends in a JavaScript or TypeScript extension (`.js`, `.ts`,
...), so a typo can never overwrite source code.

The report has this shape (schema version 3). The `summary` below is real: the MongoDB Node.js
driver at the commit listed in [docs/evaluation.md](docs/evaluation.md), scanned with default
settings (a library, so LP003 finds nothing there; the 2 files with Express handlers are a small
docs preview server and a test with a mock request handler; LP001 is off by default, so its 18
findings there are not reported):

```json
{
  "schemaVersion": 3,
  "tool": { "name": "logpilot", "version": "0.5.0" },
  "rules": [
    { "id": "LP001", "name": "empty-catch", "version": 3, "enabled": false },
    { "id": "LP002", "name": "lost-error-cause", "version": 1, "enabled": true },
    { "id": "LP003", "name": "unlogged-error-response", "version": 3, "enabled": true }
  ],
  "config": {
    "file": null, "defaultExcludes": true, "exclude": [], "minSeverity": "low", "failOn": "none", "fixPreview": false,
    "rules": { "LP001": "off", "LP002": "on", "LP003": "on" }
  },
  "summary": {
    "filesScanned": 737,
    "filesWithExpressHandlers": 2,
    "findings": 13,
    "patterns": 11,
    "findingsByRule": { "LP001": 0, "LP002": 13, "LP003": 0 },
    "findingsBySeverity": { "high": 1, "medium": 3, "low": 9 },
    "hiddenBelowMinSeverity": 0,
    "suppressed": 0,
    "skippedFiles": { "minified": 275, "vendored": 15, "userExclude": 0 },
    "skippedFolders": { "default": 1, "userExclude": 0 },
    "filesWithSyntaxErrors": 0,
    "warnings": 0,
    "exitCode": 0,
    "fixes": null
  },
  "findings": [],
  "suppressed": [],
  "skipped": [],
  "warnings": []
}
```

(The four lists are shortened to `[]` here.) Each entry has these keys:

| List | Keys |
|---|---|
| `findings` | `ruleId`, `ruleName`, `file`, `line`, `column`, `severity`, `confidence`, `evidence`, `explanation`, `suggestion`, `pattern`, `fix` |
| `suppressed` | `finding` (as above), `reason`, `commentLine` |
| `skipped` | `path`, `kind` (`file` or `folder`), `reason` (`default-folder`, `minified-name`, `minified-content`, `vendored-banner`, `user-exclude`), `detail` |
| `warnings` | `type` (`read-error`, `syntax-error`, `unused-exclude`, `invalid-suppression`, `unused-suppression`, `fix-validation-failed`), `file`, `line`, `message` |

**Fixes in JSON.** Without `--fix-preview`, every finding has `"fix": null`, `config.fixPreview` is
`false`, and `summary.fixes` is `null`. With it, `summary.fixes` is
`{ "available": n, "notAvailable": m }` (LP003 findings only), and every finding has a `fix` object:

| Key | Meaning |
|---|---|
| `status` | `"available"` or `"not-available"` (LP001 and LP002 findings are always `"not-available"`) |
| `reason` | Why there is no fix, or `null` |
| `description` | What the fix does, in one sentence, or `null` |
| `logger` | `{ "kind", "call", "confidence", "evidence" }`: which logger the fix calls (`kind` is `console`, `pino`, `winston`, `bunyan` or `project`) and why, or `null` |
| `notes` | Things to check before applying the fix (a list, may be empty) |
| `edits` | The exact change: a list of `{ "start", "end", "newText" }`. `start` and `end` are positions in the original file text, counted in JavaScript string characters (UTF-16 code units), the same way as ESLint's fix ranges. Every edit is an insertion (`start` equals `end`), and edits never overlap: apply them from the last to the first |
| `diff` | The same change as a unified diff, for reading. Line endings are shown as plain new lines; apply `edits`, not the diff |

- **Versions.** Each rule's `version` goes up when that rule starts reporting different findings or
  levels, or its explanation changes in a way that matters, so you can tell whether a change in
  results came from your code or from LogPilot. For `schemaVersion`, the policy since version 2:
  - **adding** a key does not change `schemaVersion`, so tools should ignore keys they do not know;
  - **removing or renaming** a key, or changing what a key means or which values it can hold,
    changes `schemaVersion`.
  - Version 2 added `fix`, `config.fixPreview` and `summary.fixes`. Version 1 promised that every
    object always has all its keys, so a tool could check the exact key set; that is why adding
    keys changed the version this one time.
  - Version 3 (v0.4.2): every path (`file`, `path`, `config.file` and the paths in `diff`) is
    relative to the scanned folder (for a single file, its folder). Before, paths were relative to
    the folder LogPilot was run from, so `scan src` from the project root gave `src/app.js` and now
    gives `app.js`. Version 3 also added `summary.filesWithExpressHandlers`.
  - Added in v0.4.3 (still version 3, only new keys): `enabled` for each rule, `config.rules`
    (every rule, `"on"` or `"off"` in this scan), `pattern` for each finding, and
    `summary.patterns`. A rule that is off has `"enabled": false` and 0 in `findingsByRule`, so
    "off" and "no findings" can be told apart.
- **Patterns.** Each LP001 and LP002 finding has a `pattern` ID such as `"LP002-dcfb2a11"`: the
  rule ID and 8 hex digits of a hash of its case, levels and code shape. Findings with the same ID
  share one explanation. The ID is the same on every run and every OS, and changes only if the
  pattern's parts change in a future version. LP003 findings have `"pattern": null`.
  `summary.patterns` counts distinct patterns among the shown findings (each finding without a
  pattern counts as one).
- **Stable output.** The same code gives byte-identical JSON on every run: keys in a fixed order,
  sorted lists, `/` in paths, no timestamps. Every object always has all its keys: missing values
  are `null`, and counts of 0 are included.
- **Only JSON on stdout.** In JSON mode, warnings are inside the JSON instead of on stderr, and
  skipped paths are always listed (no `--show-skipped` needed). An error that stops LogPilot
  (exit code 2) is still printed as text on stderr, and no JSON is written.
- `findings` holds only the findings at or above `minSeverity`; `summary.hiddenBelowMinSeverity`
  counts the others. `summary.exitCode` is the exit code of the run.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The scan finished, and no finding is at or above `--fail-on`. With the default `--fail-on none`, this is every finished scan, **even one with findings** |
| `1` | At least one shown finding is at or above `--fail-on` (only when you set it) |
| `2` | LogPilot could not run: bad arguments, an invalid config file, a path that does not exist, a report file it could not write, or an internal error |

These are the exit codes of `scan`. `logpilot fix` has its own: see
[Applying fixes](#applying-fixes-logpilot-fix).

**Changed in v0.2.0:** v0.1.0 exited with code 1 whenever there was a finding. Now it does so only
with `--fail-on`. Code 2 still lets scripts and CI tell "the tool failed" apart from a finished
scan.

## How LogPilot relates to ESLint

Each LogPilot rule overlaps with an existing lint rule. **If your project already uses ESLint, turn
these rules on.** They run in your editor and in your existing lint step, and LogPilot does not
replace them.

| LogPilot rule | Overlapping lint rule | What the official docs say |
|---|---|---|
| LP001 `empty-catch` | ESLint [`no-empty`](https://eslint.org/docs/latest/rules/no-empty) | Reports empty blocks, including empty `catch` blocks. A block that contains a comment is not reported, and the option `allowEmptyCatch: true` turns the `catch` check off. Enabled by the `recommended` config of `@eslint/js`. |
| LP002 `lost-error-cause` | ESLint [`preserve-caught-error`](https://eslint.org/docs/latest/rules/preserve-caught-error) (since ESLint v9.35.0) | "Disallow losing originally caught error when re-throwing custom errors": a new error thrown inside a `catch` block must keep the caught one as `cause`. Enabled by the `recommended` config of `@eslint/js` (current docs). |
| LP002 `lost-error-cause` | Biome [`useErrorCause`](https://biomejs.dev/linter/rules/use-error-cause/) (since Biome v2.3.12) | The same check as `preserve-caught-error`, for Biome users. Not recommended by default, so it must be turned on. |
| LP003 `unlogged-error-response` | SonarJS S2486, shipped in [eslint-plugin-sonarjs](https://www.npmjs.com/package/eslint-plugin-sonarjs) as `no-ignored-exceptions` | "Exceptions should not be ignored". Its code (version 4.0.3) reports every `catch (e)` whose `e` is never used, in any code. Enabled by the plugin's `recommended` config. |

**If you use eslint-plugin-sonarjs, `no-ignored-exceptions` already reports the most common LP003
case:** a `catch (err)` that answers 500 and never uses `err`. LP003 adds exactly this, and no more:

- **Case B:** the error is used, but only in the response (`res.json({ error: err.message })`).
  Sonar is silent because `err` is referenced; the server still keeps no record.
- **`catch {}` without a variable** that answers with an error. Sonar's rule only looks at catches
  that name the error.
- **Error middleware** `(err, req, res, next)` that responds without using `err`: every error
  passed on with `next(err)` disappears there. There is no catch block, so Sonar's rule does not
  apply.
- **Severity by response status:** 5xx (or no error status at all) is *high*; 4xx is *low*. On
  unseen apps, 30 of 33 high findings were real problems, and 0 of 10 4xx findings (see
  [Accuracy](#accuracy)).
- **Express context:** it looks only at request handlers, and its explanation says what your logs
  will and will not show.

What LogPilot adds today, and no more:

- **A severity and a confidence for each finding, based on the surrounding code.** For example, an
  empty catch after an existence check is *high*. An empty catch explained by a comment is still
  reported, with confidence *medium* (`no-empty` does not report it, although the error is still
  lost). A throw right after the error was logged is *low*.
- **An explanation and a suggested fix for each finding**, about what a failure investigation would
  lose. Its suggestions never include logging secrets or personal data.
- **Published accuracy measurements** for every rule ([Accuracy](#accuracy)). They show that most
  LP001 and LP002 findings are not real problems. They are a measurement, not a claim of quality.

What LogPilot does **not** offer: editor integration, automatic fixing without your approval
(`logpilot fix` asks about every fix), or the breadth of a linter.
We have not measured how many LogPilot findings these lint rules also report.

## Limitations

- **Most findings are not real problems, and severity does not yet separate the real ones.** See
  [Accuracy](#accuracy) for the measured numbers.
- **`logpilot fix`:**
  - it applies LP003 fixes only, and only those `--fix-preview` shows;
  - it needs a terminal, and has no "yes to everything" or non-interactive mode;
  - it never runs your project's tests: run them yourself after it;
  - with `core.autocrlf=true`, files whose line endings git would change on checkout are not
    offered;
  - replacing a file gives it the folder's default Windows permissions (ACLs) and, on Linux and
    macOS, your user as owner; for normal source files these are the same as before.
- **LP001 is off by default (v0.4.3),** so a default scan does not report empty catches, not even
  the few that are real problems or the "this test can never fail" case. Turn it on with
  `--enable LP001`.
- **Grouping compares the shape of the code, not what it means.** Two `throw new ApiError(...)`
  that drop the caught error are one pattern even if only one of them matters. Each location is
  still listed, but only the first finding's evidence and suggestion are printed: a listed
  finding's own suggestion details (such as LP002's rewritten `throw` with its own message) are
  shown only with `--verbose` and in the JSON report. For LP001, "the same shape" means the same
  first call in the `try` block, which may not be what the block is about.
- **LP001's "this test can never fail" check knows only the calls listed under
  [LP001 in more detail](#lp001-in-more-detail).** Assertions that fail on other falsy values
  (`assert(0)`), Jasmine's bare `fail()`, should.js, and QUnit's `assert` parameter are not
  recognised.
- **Only three rules exist: LP001 (`empty-catch`), LP002 (`lost-error-cause`) and LP003
  (`unlogged-error-response`).** Other diagnostic gaps (weak error context, unhandled promise
  rejections, unsafe logging, ...) are not detected yet. Planned, not built:
  - **LP006 `weak-failure-context`:** only the error's message is logged, without its stack trace
    or the error object (`console.error("Login failed:", err.message)`).
- **LP003 reads one file at a time.** Handlers defined in another file are recognised only by
  their `(req, res)` shape. Helpers imported from other files are assumed to handle an error they
  receive, and are not counted as responses when they receive only `res`
  (`sendError(res, 500)`).
- **LP003 checks only `try`/`catch` and error middleware.** Promise callbacks such as
  `.catch((err) => res.status(500).send(...))` are not checked, nor are other frameworks (Koa,
  Fastify, NestJS, the Next.js app router).
- **LP003 judges the whole catch block.** If the error is logged on one branch, a 500 on another
  branch that drops it is not reported.
- **LP003 counts the error as logged when only part of it is logged.**
  `console.error("Login failed:", err.message)` keeps the message but loses the stack trace and
  properties such as `code`. LP003 does not report it. Weak error context like this is not
  detected by any rule yet (planned as LP006, above).
- **No fix preview** is proposed for LP001 or LP002 findings, nor for these LP003 findings: a
  catch that only answers 4xx (case E), `catch ({ message })`, error middleware written as an arrow
  function without braces, a `try` block that calls axios, files with syntax errors, and code where
  a local variable shares a name with the request, the error, the logger or `console`. The report
  says why each time.
- **Logging a whole error can still write secrets or personal data, if the error itself holds
  them.** We measured this for axios: its errors contain the outgoing request's headers (including
  `Authorization`) and URL, so LP003's fix previews skip `try` blocks that call axios. Other HTTP
  clients and SDKs (got, node-fetch, cloud SDKs) were not measured and may also put secrets in their
  errors. Database errors can contain the values that failed, too (for example, MongoDB's
  duplicate-key error names the duplicated value). Check that your logger redacts them.
- **A fix preview's placement is simple.** With several 5xx responses in a catch, or a 5xx in an
  `if` or `else` without braces, the log line goes at the start of the catch block, so it also logs
  the failures answered with 4xx; the fix says so. Fixes are checked by parsing and by running
  LogPilot's rules again, not by type-checking TypeScript or running your tests.
- **Fix previews recognise only some loggers.** pino, winston and bunyan created at the top level of
  the file, or in a relative module the file imports (one step: a module that re-exports a logger
  from another file is not followed). Other loggers are used only when the file already logs a
  caught error with them; otherwise the fix uses `console.error` and says why.
- **A fix's log line keeps the error's cause only with console and pino.** With winston and bunyan,
  the fix notes that `error.cause` is not logged, and with winston a custom format that prints only
  the message also drops the stack trace (the fix tells you to check the format).
- **LP003's case E (4xx) has found no real problem so far,** only debatable cases such as
  authentication checks that answer 401. Its *low* severity was set after that measurement and has
  not been measured itself.
- **Generated code in unusual folders is scanned.**
  - Since v0.4.1, dot-named build folders such as `.server-build/` are skipped (see
    [What LogPilot does not scan](#what-logpilot-does-not-scan)).
  - A build folder with another name, such as `server-build/` or `compiled/`, is still scanned; add
    an `exclude` pattern for it.
  - Only those dot folders are skipped, not every dot folder: across the 25 evaluated projects, dot
    folders such as `.github`, `.vitepress`, `.husky` and test fixtures hold the projects' own code.
- **The password note on fix previews sees only the `try` block's own code.**
  - It misses a password that is saved through a variable (`const data = { ...req.body };
    User.create(data)`) or through a helper.
  - It misses a model from a package or from outside the scanned folder.
  - Some names that count as password-like hold no secret (see [Fix previews](#fix-previews)).
  - It does not check whether the value is validated before saving, so the note can be a reminder
    rather than a found problem.
  - The way the value ends up in the error was measured with Mongoose only.
- **Suppressions work one line at a time.** There is no way to turn a rule off for a whole file or
  project; use `exclude` patterns to skip whole files and folders.
- **`--min-severity` can hide real problems,** because real problems have been reported at every
  level that also holds most of the noise.
- **Copied third-party files are only recognised when they are minified or start with a versioned
  `/*!` banner.** An unminified copy without such a banner (in the MongoDB driver, the LiveReload
  client) is still scanned; add an `exclude` pattern for it.
- **LP001 cannot read a comment's meaning.** A comment directly above or inside the try lowers the
  confidence even when it talks about something else, or is wrong. (On knex and node-postgres, all
  3 real problems had a comment, "pg may not be installed", that did not match the code.)
- **Tool directives never count as explanations,** even with a description such as
  `// eslint-disable-line no-empty -- closing twice is harmless`. On knex and node-postgres, the 5
  catches explained only by an `eslint-disable` directive were all not real problems, so a
  directive may still say something about intent.
- **LP001 recognises "handling another error" only inside a `catch` block**, not inside helper
  functions that format an error.
- **Promise `.catch(() => {})` callbacks are not detected.** Only `try { } catch { }` statements are checked.
- **Catch blocks that contain code but ignore the error are not detected**, e.g.
  `catch (err) { return null; }` or `catch (err) { retries++; }`.
- Long lines in the text report are word-wrapped, which can split a code example across two lines.
- Symbolic links are not followed.

### What LP002 will miss

LP002 reads one file's syntax tree, without type information, and only looks at `throw`
statements that leave a `catch` block directly. It does **not** see:

- Promise callbacks: `.catch((err) => { throw new Error("Failed") })`.
- Errors made by a function instead of `new`: `throw createError(500)`, `throw Boom.internal()`,
  `throw Object.assign(new Error("Failed"), { code })`.
- An error built first and thrown later: `const e = new Error("Failed"); throw e;`.
- Errors that are passed on instead of thrown: `reject(new Error(...))`, `next(new Error(...))`,
  `callback(new Error(...))`.
- Throws inside callbacks or nested functions within the catch block.
- Your own error classes receiving the result of a helper: `new AppError(format(err))` counts
  as keeping the whole error. (For the built-in `Error`, the 1st argument is always just the
  message, so `new Error(format(err))` *is* reported.)

### Where LP002 may be wrong

- **Deliberately replacing an expected error** without an `if` that checks it is reported at
  high severity when the catch keeps the error in a variable (with `catch {}` it is medium). So is
  deliberately hiding details at an API boundary when no comment says so.
- **An `if` that checks the caught error can lower a real problem to low**, for example a retry
  that replaces the original failure with a new error.
- **It matches the caught error by name.** Another variable with the same name inside the
  catch block, or a project class named `Error`, can mislead it.
- **Test code** such as `catch { throw new Error("should not get here") }` is reported. You can
  suppress such a finding with a `logpilot-ignore-next-line LP002 -- reason` comment, or skip test
  folders with an `exclude` pattern.

## Troubleshooting

**Git Bash: "stdout is not a tty", and an empty report file.** In Git Bash, Git for Windows makes
`node` an alias for `winpty node.exe` (check with `type node`). winpty only works when the output
goes to the terminal, so `node dist/cli.js scan . > report.txt` or `node dist/cli.js scan . | less`
prints `stdout is not a tty` and the report stays empty. Either call `node.exe` directly when you
redirect or pipe:

```bash
node.exe dist/cli.js scan . > report.txt
```

or let LogPilot write the file, which works with the alias too:

```bash
node dist/cli.js scan . --output report.txt
```

(Both checked in Git Bash with Git for Windows 2.47. PowerShell and VS Code's terminal have no such
alias.)

**`npm test` fails with "Vitest failed to find the runner" (Windows).** Your terminal's current
folder has a lowercase drive letter (`c:\code\logpilot` instead of `C:\code\logpilot`). Node then
loads Vitest twice, because it treats the two spellings as different files. VS Code's terminal can
start in such a folder. Check with `node -p "process.cwd()"`; if it starts with a lowercase
letter, `cd` into the folder again with an uppercase drive letter (for example
`cd C:\code\logpilot` in PowerShell, or `cd / && cd /c/code/logpilot` in Git Bash) and try again.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md): development setup, tests, project layout, and how to propose
  a new rule.
- LogPilot scans its own code in CI (`node dist/cli.js scan . --fail-on low`, test fixtures excluded
  in [logpilot.config.json](logpilot.config.json)) and must report 0 findings.
- [Issues](https://github.com/rajatjain3366/logpilot/issues/new/choose): report a false positive,
  a missed problem, or a bug. Please share minimal code snippets, never real secrets.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- [docs/early-tester-guide.md](docs/early-tester-guide.md): try LogPilot on your own Express
  project and tell us which findings were useful.

## License

[MIT](LICENSE)
