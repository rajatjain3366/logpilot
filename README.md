# LogPilot

[![CI](https://github.com/rajatjain3366/logpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/rajatjain3366/logpilot/actions/workflows/ci.yml)

**If this code fails in production, will you have enough information to find out why?**

LogPilot is an open-source, local command-line tool that scans JavaScript and TypeScript
(Node.js) projects for code that would leave you **without evidence** when something goes
wrong in production, for example an error that is caught and then silently thrown away.

> **Status: early prototype (v0.2.0 plus unreleased LP003).** Three rules exist today. The CLI is not published to
> npm yet; see [Usage](#usage) for running it from this repository.

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

LogPilot finds these patterns, explains why each one hurts a future investigation, and
suggests how to fix it.

## Principles

- **Local and private.** Runs on your machine. No account, no upload, no network needed to scan.
- **Read-only.** A scan never modifies your files.
- **Accurate over noisy.** Few, well-explained findings beat many weak warnings. A missing
  `console.log` is not automatically a problem.
- **Safe suggestions.** LogPilot never suggests logging secrets, tokens, credentials, payment
  data, or unnecessary personal data.

## Scope

| Rule | Name | Detects | Severity | Confidence |
|---|---|---|---|---|
| `LP001` | `empty-catch` | A `catch` block with no statements: `catch (e) {}`, `catch {}`. Worth reviewing | medium | high |
| | | …and an existence check on the same thing runs first (`if (existsSync(f)) { try { read(f) } catch {} }`, also `map.has(k)`, `k in obj`, `stat(p).isFile()`, or an early `if (!existsSync(f)) return;`), so only *unexpected* errors can reach the catch | high | unchanged |
| | | …and a comment explains the ignore: inside the catch, inside the try, on the line(s) directly above the `try`, or right after the catch's `}` | unchanged | medium |
| | | …inside another `catch` whose own error is still thrown, returned or passed on (best-effort work while handling that error) | low | unchanged |
| | | …around a test assertion that fails by throwing, so the test can never fail there (this overrides all rows above). See the list below | high | high |
| `LP002` | `lost-error-cause` | A `catch` block throws a new error that drops the caught one: `catch (err) { throw new Error("Load failed") }` | high | high |
| | | The new error keeps only the caught error's text: ``new Error(`Load failed: ${err.message}`)``, `"x: " + err`, `String(err)`, `new Error(err)` | medium | high |
| | | The caught error is passed as `Error`'s 2nd argument, which is an options object, so it is lost: `new Error("Load failed", err)` | high | high |
| `LP003` | `unlogged-error-response` | An Express handler's `catch` (or error middleware) sends an error response, and the caught error is never logged, passed to `next()` or rethrown. See [LP003 in more detail](#lp003-in-more-detail) | high, or low for a 4xx answer | high or medium |

> **LP001 is frozen at version 2, and we recommend ESLint's
> [`no-empty`](https://eslint.org/docs/latest/rules/no-empty) instead.** On code it was not tuned
> on (knex and node-postgres), **3 of LP001's 25 findings were real problems (12%)**, and severity
> did not separate them from the rest. `no-empty` reports the same empty catch blocks, in your
> editor. LP001 stays in LogPilot as it is; future work goes into Express rules such as LP003.

For LP001, an outer error that is passed on wins over an existence check; a comment does not.

- **Severity** = how much the problem would hurt a failure investigation, and how much evidence
  there is for that:
  - *high*: positive evidence that the lost error matters;
  - *medium*: worth reviewing, the default when there is no such evidence;
  - *low*: probably deliberate or minor.
- **Confidence** = how sure LogPilot is that it is a real problem and not a deliberate,
  harmless choice. A comment next to an empty catch suggests the author ignored the error on
  purpose, so LP001 lowers the confidence to *medium*.
  - **The comment does not lower the severity** (changed in LP001 version 2). Earlier
    measurements found real bugs next to comments such as "should throw" or "pg may not be
    installed": a comment shows intent, not harmlessness.

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

Files scanned: `.js .jsx .ts .tsx .mjs .cjs .mts .cts`. Some folders and files are skipped by
default; see [What LogPilot does not scan](#what-logpilot-does-not-scan).

### LP003 in more detail

LP003 looks at Express request handling: a `catch` that answers the client with an error, while
the error itself is never recorded. In production you then see "500" and nothing else:

```js
router.get("/users/:id", async (req, res) => {
  try {
    res.json(await User.findById(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Server error" }); // LP003: err is never logged or passed on
  }
});
```

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
| E: a 4xx response, error never logged | `res.status(400).json({ message: "Invalid data" })` | low (medium before LP003 version 2) | medium |

A request logger does not change this. morgan, pino-http and express-winston record the request
and its status code; their documentation describes no way to record an error the handler caught
itself. express-winston's `errorLogger`, and your own error middleware, only see errors passed on
with `next(err)`.

**Measured on 12 Express and MERN apps it was not tuned on:**

- 30 of its 43 findings were real problems (70%).
- At high severity: 30 of 33 (91%).
- Case E (4xx) found none: all 10 were debatable authentication or validation answers. They were
  measured at *medium*. Case E was lowered to *low* afterwards (LP003 version 2), so its new level
  has not been measured.
- One app gave 17 of the 30 real problems, all one repeated pattern, so expect fewer elsewhere.
- A blind second labeller checked 10 of the findings. They agreed on all 8 at high severity. They
  labelled the 2 case E findings as real problems, where Claude had said debatable. High-severity
  precision is the same either way
  ([details](docs/evaluation.md#lp003-second-labeller-check)).

See [docs/evaluation.md](docs/evaluation.md#current-results-lp003-on-held-out-express-apps).

## Usage

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
logpilot --help, -h              Show help
logpilot --version, -v           Show the version

Scan options:
  --config <file>          Use this config file instead of looking for logpilot.config.json
  --no-config              Do not use any config file
  --exclude <pattern>      Do not scan matching files or folders, e.g. "docs/**" (can be repeated;
                           adds to "exclude" in the config file)
  --show-skipped           List every file and folder that was not scanned, and why
  --no-default-excludes    Also scan build output, third-party folders, minified and vendored files
                           (node_modules and .git are never scanned)
  --min-severity <level>   Show only findings at or above low | medium | high (default: low)
  --fail-on <level>        Exit with 1 if a finding is at or above none | low | medium | high
                           (default: none, so findings alone never fail the scan)
  --format <text|json>     Report format (default: text). JSON includes warnings and skipped paths
  --output <file>          Write the report to this file instead of the terminal
```

### What LogPilot does not scan

Scanning the wrong files was the biggest source of noise we measured: 90% of the MongoDB driver's
findings were inside copies of jQuery in its documentation site. So LogPilot skips these by
default:

| Skipped | Why |
|---|---|
| Folders `node_modules`, `.git` | dependencies and git internals: **never scanned**, even with `--no-default-excludes` |
| Folders `vendor`, `bower_components`, `jspm_packages` | third-party code |
| Folders `dist`, `build`, `coverage`, `.next`, `.nuxt`, `.output`, `.svelte-kit` | generated output |
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

### Configuration

Put a `logpilot.config.json` in your project:

```json
{
  "exclude": ["docs/**", "scripts/**"],
  "defaultExcludes": true,
  "minSeverity": "low",
  "failOn": "none"
}
```

| Setting | Meaning | Default |
|---|---|---|
| `exclude` | Glob patterns of files and folders not to scan, relative to the config file's folder | `[]` |
| `defaultExcludes` | Skip the default folders, minified and vendored files listed above | `true` |
| `minSeverity` | Show only findings at or above `low`, `medium` or `high` (see [Choosing what to show, and when to fail](#choosing-what-to-show-and-when-to-fail)) | `"low"` |
| `failOn` | Exit with code 1 when a shown finding is at or above `none`, `low`, `medium` or `high` | `"none"` |

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

### Suppressing a finding

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
- The summary counts suppressed findings (`1 finding was suppressed by logpilot-ignore comments.`).
  The JSON report lists each one with its reason.

### Choosing what to show, and when to fail

- `--min-severity medium` hides *low* findings. The summary says how many were hidden:
  `1 finding below medium severity is not shown (--min-severity).`
- `--fail-on <level>` makes LogPilot exit with code 1 when a shown finding is at or above that
  level, for example to stop a CI job.
- **By default, findings never fail a scan (`--fail-on none`): LogPilot is warning-only.** This
  changed in Milestone 2: v0.1.0 exited with code 1 whenever there was a finding. Use
  `--fail-on low` for the old behaviour.
- A `--fail-on` level below `--min-severity` (for example `--min-severity high --fail-on medium`)
  is refused with exit code 2, because LogPilot would fail on findings it does not show.
- Both can be set in the config file (`minSeverity`, `failOn`); command-line options win.

> **Severity is not reliable yet.** On code LogPilot was not tuned on, real problems got the same
> severity as most findings that were not real problems (see [Limitations](#limitations)). Review
> findings of every severity before relying on `--fail-on`, and do not use `--min-severity` to
> hide findings you have never looked at.

### Example output

```text
test/fixtures/positive/empty-catch.ts:9:5
  LP001 empty-catch | severity: medium | confidence: high
  Evidence:
    9 |   } catch (err) {}
  Why: This catch block is empty. If the code in the try block fails, the error is discarded and
       nothing records it. That can be deliberate, for example for an optional step or an expected
       failure, so review it: if a failure here could ever need investigating, it would leave no
       trace.
  Fix: Handle the error explicitly: log it with your project's logger (e.g. logger.error({ err },
       "failed to load config")), rethrow it with context (throw new Error("Failed to load config",
       { cause: err })), or return a deliberate fallback value. When logging, include the error and
       safe context such as the operation name or record IDs, never passwords, tokens, or full
       request bodies.

Scanned 1 file, 3 findings (LP001: 3)
```

An LP002 finding (from `node dist/cli.js scan test/fixtures/positive/lp002-options-mistake.ts`):

```text
test/fixtures/positive/lp002-options-mistake.ts:11:5
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

The report goes to **stdout** (or to the `--output` file); errors and warnings go to **stderr**.
A file with syntax errors is still scanned as far as possible, and LogPilot warns about it
(`Warning: x.js: 1 syntax error (first at line 1: Expression expected.); findings in this file may be incomplete`)
and counts such files in the summary. Warnings do not change the exit code.

### JSON output

`--format json` prints the report as JSON, for other tools to read. `--output <file>` writes the
report (JSON or text) to a file instead of the terminal:

```bash
node dist/cli.js scan . --format json --output logpilot-report.json
```

LogPilot refuses an `--output` file that ends in a JavaScript or TypeScript extension (`.js`, `.ts`,
...), so a typo can never overwrite source code.

The report has this shape (schema version 1). The `summary` below is real: the MongoDB driver
from [docs/evaluation.md](docs/evaluation.md), scanned with LP001 version 2 and LP003 (a library, so
LP003 finds nothing there):

```json
{
  "schemaVersion": 1,
  "tool": { "name": "logpilot", "version": "0.2.0" },
  "rules": [
    { "id": "LP001", "name": "empty-catch", "version": 2 },
    { "id": "LP002", "name": "lost-error-cause", "version": 1 },
    { "id": "LP003", "name": "unlogged-error-response", "version": 2 }
  ],
  "config": { "file": null, "defaultExcludes": true, "exclude": [], "minSeverity": "low", "failOn": "none" },
  "summary": {
    "filesScanned": 737,
    "findings": 31,
    "findingsByRule": { "LP001": 18, "LP002": 13, "LP003": 0 },
    "findingsBySeverity": { "high": 5, "medium": 17, "low": 9 },
    "hiddenBelowMinSeverity": 0,
    "suppressed": 0,
    "skippedFiles": { "minified": 275, "vendored": 15, "userExclude": 0 },
    "skippedFolders": { "default": 1, "userExclude": 0 },
    "filesWithSyntaxErrors": 0,
    "warnings": 0,
    "exitCode": 0
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
| `findings` | `ruleId`, `ruleName`, `file`, `line`, `column`, `severity`, `confidence`, `evidence`, `explanation`, `suggestion` |
| `suppressed` | `finding` (as above), `reason`, `commentLine` |
| `skipped` | `path`, `kind` (`file` or `folder`), `reason` (`default-folder`, `minified-name`, `minified-content`, `vendored-banner`, `user-exclude`), `detail` |
| `warnings` | `type` (`read-error`, `syntax-error`, `unused-exclude`, `invalid-suppression`, `unused-suppression`), `file`, `line`, `message` |

- **Versions.** `schemaVersion` will change when the shape changes in a way that could break a tool
  reading it. Each rule's `version` goes up when that rule starts reporting different findings or
  levels, so you can tell whether a change in results came from your code or from LogPilot.
- **Stable output.** The same code gives byte-identical JSON on every run: keys in a fixed order,
  sorted lists, `/` in paths, no timestamps. Every object always has all its keys: missing values
  are `null`, and counts of 0 are included.
- **Only JSON on stdout.** In JSON mode, warnings are inside the JSON instead of on stderr, and
  skipped paths are always listed (no `--show-skipped` needed). An error that stops LogPilot
  (exit code 2) is still printed as text on stderr, and no JSON is written.
- `findings` holds only the findings at or above `minSeverity`; `summary.hiddenBelowMinSeverity`
  counts the others. `summary.exitCode` is the exit code of the run.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | The scan finished, and no finding is at or above `--fail-on`. With the default `--fail-on none`, this is every finished scan, **even one with findings** |
| `1` | At least one shown finding is at or above `--fail-on` (only when you set it) |
| `2` | LogPilot could not run: bad arguments, an invalid config file, a path that does not exist, a report file it could not write, or an internal error |

**Changed in Milestone 2:** v0.1.0 exited with code 1 whenever there was a finding. Now it does so
only with `--fail-on`. Code 2 still lets scripts and CI tell "the tool failed" apart from a
finished scan.

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
- **Severity by response status:** 5xx (or no error status at all) is *high*; 4xx is *medium*.
  Measured: high 30/33 real problems, 4xx 0/10.
- **Express context:** it looks only at request handlers, and its explanation says what your logs
  will and will not show.

What LogPilot adds today, and no more:

- **A severity and a confidence for each finding, based on the surrounding code.** For example, an
  empty catch after an existence check is *high*. An empty catch explained by a comment is still
  reported, with confidence *medium* (`no-empty` does not report it, although the error is still
  lost). A throw right after the error was logged is *low*.
- **An explanation and a suggested fix for each finding**, about what a failure investigation would
  lose. Its suggestions never include logging secrets or personal data.
- **Published evaluation evidence.** Every finding on several real projects was labelled by hand
  ([docs/evaluation.md](docs/evaluation.md)). Today that evidence shows that most findings are not
  real problems, and that severity does not yet separate the real ones (see
  [Limitations](#limitations)). It is a measurement, not a claim of quality. The labels, sealed
  files, protocols and scripts that recompute the numbers are in
  [docs/eval-data/](docs/eval-data/README.md). Student and beginner apps are anonymized there and
  in the evaluation (App A to App T).

What LogPilot does **not** offer: editor integration, automatic fixes, or the breadth of a linter.
We have not measured how many LogPilot findings these lint rules also report.

## Limitations

- **Most findings are not real problems, and severity does not yet separate the real ones
  (measured).** Results on code that played no part in designing the rules (held-out); details
  and every labelled finding are in [docs/evaluation.md](docs/evaluation.md):

  | Held-out project | Rules measured | Findings | True positives | High severity |
  |---|---|---|---|---|
  | 12 Express/MERN apps (Milestone 2.5) | LP003 only | 43 | 30 (70%; by pattern 6 of 16) | 30 of 33 real |
  | knex + node-postgres (round 3) | LP001 version 2 only | 25 | 3 (12%) | none |
  | MongoDB Node.js driver, everything scanned (round 2) | LP001 v1, LP002 | 288 | 6 (2%) | 1 finding, not a true positive |
  | MongoDB Node.js driver, its own code only (round 2) | LP001 v1, LP002 | 30 | 6 (20%) | the same 1 finding |
  | 3 small Express/MERN apps (round 2) | LP001 v1, LP002 | 11 | 1 (9%) | none |

  - **High severity is rare,** because it needs positive evidence. That is too few findings to
    check our 70% target for high severity.
  - **Real problems get the same severity as most noise.** In round 2, 6 of the 7 real problems
    were *low*, because a comment lowered them. LP001 version 2 no longer does that: in round 3
    its 3 real problems were *medium*, but so were 21 of the 22 findings that were not.
  - **90% of the MongoDB driver's findings were in third-party libraries** copied into its
    documentation site (copies of jQuery). These numbers were measured before the default
    excludes existed; see [What LogPilot does not scan](#what-logpilot-does-not-scan). Re-scanned
    with the default excludes, the driver gives 31 findings: the same 30 in its own code, plus one
    in a copied LiveReload client. Precision was not measured again.
  - **LP003's numbers rest on few apps and mostly on one labeller.** One app gave 17 of its 30
    real problems, all the same pattern. A blind second labeller checked 10 findings. They agreed
    on all 8 at high severity and disagreed on both case E findings.
- **LP001's "this test can never fail" check knows only the calls listed under
  [Scope](#scope).** Assertions that fail on other falsy values (`assert(0)`), Jasmine's bare
  `fail()`, should.js, and QUnit's `assert` parameter are not recognised.
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
  detected by any rule yet (planned as LP006, below).
- **LP003's case E (4xx) found no real problem in the measurement,** only debatable cases such as
  authentication checks that answer 401. So version 2 reports case E at *low* severity instead of
  *medium*. That change was made after the measurement, so the new level is not measured.
- **Generated code in unusual folders is scanned.** A build folder named, say, `.server-build/`
  is not one of the default skips; add an `exclude` pattern for it.
- **Suppressions work one line at a time.** There is no way to turn a rule off for a whole file or
  project; use `exclude` patterns to skip whole files and folders.
- **`--min-severity` can hide real problems,** because real problems have been reported at every
  level that also holds most of the noise.
- **Copied third-party files are only recognised when they are minified or start with a versioned
  `/*!` banner.** An unminified copy without such a banner (in the MongoDB driver, the LiveReload
  client) is still scanned; add an `exclude` pattern for it.
- **LP001 cannot read a comment's meaning.** A comment directly above or inside the try lowers the
  confidence even when it talks about something else, or is wrong. (In round 3, all 3 real
  problems had a comment, "pg may not be installed", that did not match the code.)
- **Tool directives never count as explanations,** even with a description such as
  `// eslint-disable-line no-empty -- closing twice is harmless`. In round 3, the 5 catches
  explained only by an `eslint-disable` directive were all not real problems, so a directive may
  still say something about intent.
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

## Development

```bash
npm ci              # install dependencies
npm run typecheck   # type-check src/ and test/ (writes no files)
npm run build       # compile src/ to dist/
npm test            # type-check, build, then run all tests (Vitest)
```

`tsconfig.json` is the main TypeScript config (type-checking and your editor);
`tsconfig.build.json` extends it and compiles only `src/` into `dist/`.
`vitest.config.ts` makes Vitest run only `test/*.test.ts`: the files in `test/fixtures/` are
sample input for the scanner (some are even named `*.spec.ts`) and must never run as tests.

Continuous integration ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs
`npm ci` and `npm test` on every push to `main` and every pull request, on Node 22 and 24,
on Ubuntu and Windows.

Project layout:

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
  classmate-trial.md               instructions for classmates trying LogPilot on their own projects
```

Every rule needs tests for both problematic code (positive) and correct code that must not
be reported (negative). Each rule's tests run it over every file in `fixtures/negative/`.

## Troubleshooting

**`npm test` fails with "Vitest failed to find the runner" (Windows).** Your terminal's current
folder has a lowercase drive letter (`d:\logpilot` instead of `D:\logpilot`). Node then loads
Vitest twice, because it treats the two spellings as different files. VS Code's terminal can
start in such a folder. Check with `node -p "process.cwd()"`; if it starts with a lowercase
letter, run `cd / && cd /d/logpilot` (Git Bash) and try again.

## License

[MIT](LICENSE)
