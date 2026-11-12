# Security policy

## Supported versions

LogPilot is an early prototype (version 0.x). Security fixes are made on the `main` branch and in
the next release only.

## Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub's private vulnerability reporting:

1. Go to the repository's [Security tab](https://github.com/rajatjain3366/logpilot/security).
2. Click **Report a vulnerability**, and describe the problem. (Direct link:
   [new private report](https://github.com/rajatjain3366/logpilot/security/advisories/new).)

Only you and the maintainer can see the report.

Please include:

- the LogPilot version or commit (`node dist/cli.js --version`), your Node.js version and
  operating system;
- the command you ran;
- a **minimal** example that shows the problem: a few lines of made-up code, not your real
  project.

**Never include real secrets** (passwords, API keys, tokens, private keys, customer data) in a
report, even a private one. Replace them with obviously fake values such as `FAKE_TOKEN_123`.

LogPilot is maintained by one person, so an answer may take a few days. Once the problem is fixed,
the fix is released and the report can be made public, with credit to you if you want it.

## What counts as a security problem

LogPilot promises to only **read** the code it scans, locally. Examples of problems we want to
hear about privately:

- a scan that creates, changes or deletes a file (other than the `--output` report file you asked
  for), or reads files outside the path you gave it;
- a scan that sends anything over the network;
- scanned code being executed (LogPilot only parses code; it never runs it);
- a crafted file that makes LogPilot hang, crash in an unsafe way, or write its report somewhere
  unexpected;
- a suggestion that tells users to log secrets, tokens, credentials or personal data.

Wrong or missing findings (false positives, missed problems) are not security problems: please use
the [issue templates](https://github.com/rajatjain3366/logpilot/issues/new/choose) for those.
