# LogPilot

**If your code fails in production, will you have enough information to find out why?**

LogPilot is an open-source command-line tool for Node.js / Express backends. It finds places where an error is caught but the evidence is lost — and it can safely fix them, only after you approve each change.

[View on GitHub](https://github.com/rajatjain3366/logpilot) · [Latest release](https://github.com/rajatjain3366/logpilot/releases) · [Try it (tester guide)](https://github.com/rajatjain3366/logpilot/blob/main/docs/early-tester-guide.md)

---

## The problem

```js
router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await Order.findById(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Server error" });   // the error is gone
  }
});
```

The user sees "Server error". Your logs see nothing. Request loggers such as morgan record only "500", and your error middleware never sees the error because it was never passed on. When this fails in production, nobody can tell why.

## What LogPilot does

**Scan → Detect → Explain → Propose a fix → You approve → Apply → Validate**

```text
routes/orders.js:6:5
  LP003 unlogged-error-response | severity: high | confidence: high
  Why: This catch sends an error response (status 500) but never logs the error...
  Proposed fix (preview only, not applied):
    } catch (err) {
  +   console.error("Request failed:", { method: req.method, route: req.route?.path }, err);
      res.status(500).json({ message: "Server error" });
```

- **Understands Express**: route handlers, routers, middleware and error middleware — not just single lines.
- **Explains** what you would lose in production, in plain language.
- **Proposes a minimal fix** using your project's own logger (pino, winston, bunyan) or `console.error`.
- **Never logs secrets**: fixes may only log the error, `req.method` and the route pattern — never bodies, headers, query strings, cookies or URLs.

## Quick start

You need Node.js 22.20+ and Git.

```bash
git clone https://github.com/rajatjain3366/logpilot.git
cd logpilot
npm ci
npm run build

node dist/cli.js scan "../your-backend"                 # read-only report
node dist/cli.js scan "../your-backend" --fix-preview   # see proposed fixes
node dist/cli.js fix  "../your-backend"                 # apply fixes, asking y/n for each
```

Windows tip: in Git Bash, use `--output report.txt` instead of `> report.txt`.

## Why trust it

**Guaranteed, and enforced by tests in CI:**
- `scan` never writes a file (tested under Node's permission model with no write access).
- `fix` writes only after you type `y`, only inserts code, never leaves a half-written file, refuses files with uncommitted changes, and every change can be undone with `git checkout`.
- No network access and no telemetry.
- Same input gives byte-identical output on Windows and Linux.

**Measured, and published with the method:**
- Held-out accuracy of LP003 (high severity): **30 of 33 findings were real problems** on 12 apps the rule was never tuned on, with a blind second reviewer.
- Robustness: scanned **100 real public repositories** (600 runs) with **0 crashes and 0 hangs** after fixing the one bug the run found.
- Fix safety: on copies of 7 real apps, **99 of 99** proposed fixes applied cleanly and every changed file still parses.
- **640 automated tests**; LogPilot also scans its own code in CI.

By default, LogPilot only shows findings from rules that passed a 70% accuracy gate on unseen code. Everything else is opt-in. [Full evaluation method and numbers →](https://github.com/rajatjain3366/logpilot/blob/main/docs/evaluation.md)

## How it compares

| | ESLint / SonarJS | LogPilot |
|---|---|---|
| Empty catch / lost cause | Yes (`no-empty`, `preserve-caught-error`) | Yes, but recommends ESLint for these |
| Understands Express handlers and middleware | No | Yes |
| Explains the production impact | Short message | Yes |
| Safe, validated fixes with approval | Partial | Yes |
| Publishes measured accuracy per rule | No | Yes |

## Honest limitations

- The main rule (LP003) checks **Express** apps only; Next.js API routes are not covered yet.
- Fixes exist for LP003 only.
- Files with Flow type annotations may be only partly scanned.
- Accuracy numbers come from small samples; see the evaluation page for confidence intervals.
- Not yet published on npm.

## Roadmap

Done: CLI scanner, configuration and suppressions, fix previews, approval-based fixes, trust and robustness testing.
Next: fix-safety run on 100 repos, release v0.6.0, then a new rule for weak error context (logging only `err.message`).

---

Built by Rajat Jain · MIT License · [Report a false positive](https://github.com/rajatjain3366/logpilot/issues/new/choose)