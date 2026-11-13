# Early tester guide: try LogPilot on your Express project (about 20 minutes)

Thank you for helping. LogPilot is an early-stage open-source tool that reads the code of a
Node.js or Express project and points out places where, if something fails in production, you
would have **no clue why**. For example, a `catch` that answers "500" but never logs the error.

We want to know whether its findings are **useful to you**, not whether your code is good. There
are no wrong answers, and nothing you send is shared with your name.

## Before you start

- **Your code stays on your computer.** LogPilot only reads files. It never changes them, never
  uploads anything, and needs no account or internet connection to scan.
- You need **Node.js 22.20 or newer** (on Node 24: 24.8 or newer; check with `node --version`)
  and **git**.
- Use a project with an **Express backend** (a MERN project is perfect).

## Steps

1. Get LogPilot. If you were given a commit to test, check it out, so every tester uses the same
   version; otherwise skip the `git checkout` line.

   ```bash
   git clone https://github.com/rajatjain3366/logpilot.git
   cd logpilot
   git checkout <commit you were given>
   npm ci
   npm run build
   ```

2. Scan your project's backend folder (still inside the `logpilot` folder):

   ```bash
   node dist/cli.js scan path/to/your/project/backend --output logpilot-report.txt
   ```

   **If the path has spaces, put it in double quotes**, for example:

   ```bash
   node dist/cli.js scan "C:/Users/you/My Projects/shop/backend" --output logpilot-report.txt
   ```

   `--output` makes LogPilot write the report file itself. This works in every terminal. In Git
   Bash, writing it with `>` instead fails with "stdout is not a tty" unless you type `node.exe`
   instead of `node` (see [Troubleshooting](../README.md#troubleshooting)).

   The last lines of `logpilot-report.txt` say how many files were scanned and how many findings
   there are. Zero findings is a useful answer too. Since v0.4.3, empty catches (LP001) are not
   reported unless you add `--enable LP001`.

3. Open `logpilot-report.txt`. For **each finding**, read the "Why" and "Fix" lines and look at
   your code at the `file:line` shown. When several findings have the same pattern, the report
   shows the first one in full and lists the others under it ("Same pattern in N more places");
   one row in the table below can then cover the whole pattern (write all its locations, or
   "and N more").

4. Fill in the table below: one row per finding, at most 15 rows. If there are more, take every
   second one.

5. Optional: look at the fixes LogPilot proposes for its LP003 findings.

   ```bash
   node dist/cli.js scan path/to/your/project/backend --fix-preview --output logpilot-fixes.txt
   ```

   Under each LP003 finding there is now a "Proposed fix" with a diff: the lines starting with `+`
   are what LogPilot would add. **Nothing is changed in your project**: it is only a preview, and
   you decide whether to copy it. Note in the last column of the table whether the fix looks right.

## What to send back

Copy this table into a message and fill it in. Use the rule and line from the report; you do not
need to copy any code.

**Write each file path relative to your project folder,** for example `backend/routes/auth.js:92`.
Since v0.4.2 the report already shows paths relative to the folder you scanned, so if you scanned
`backend`, the report says `routes/auth.js:92`; add `backend/` in front. Never send a full path
such as `C:/Users/you/...`: it can show your user name and folder names.

| # | Rule (e.g. LP003) | File:line | Useful? (fixed / will fix / not useful / didn't understand) | If not useful: why? | Proposed fix (optional): looks right / would change it / wrong |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |

Then answer, in a sentence or two each:

1. Did any finding show you something you did not know about your code?
2. Was any explanation confusing? Which one, and what was unclear?
3. Is there a failure in your project you once struggled to debug that LogPilot did **not** point
   out?
4. How long did all of this take?
5. Which Node.js version and operating system did you use?
6. If you looked at the proposed fixes: would you apply any of them? If one was wrong, what was
   wrong with it (where it put the log line, what it logs, which logger it used)?

**Please do not send your code or the full report** unless you want to. The report contains
snippets of your code. If you do send it, look through it first and remove anything private, and
never include passwords, tokens or other secrets.

Send your answers to the person who invited you to test LogPilot. Results will only be reported as
totals ("8 of 20 findings were useful"), never with your name or your code, unless you say that
is fine.
