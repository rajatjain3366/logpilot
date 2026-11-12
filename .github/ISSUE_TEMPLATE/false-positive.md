---
name: False positive
about: LogPilot reported code that is fine
title: "False positive: LPxxx "
labels: ["false positive"]
---

<!--
Please do NOT paste real secrets (passwords, API keys, tokens, customer data) or your whole
private file. Replace names and values with made-up ones, and shorten the code to the smallest
snippet that still gets the finding.
-->

**The finding** (copy the rule line, severity and confidence from the report):

```text
LPxxx rule-name | severity: ... | confidence: ...
```

**Minimal code that gets this finding:**

```js

```

**Why this code is fine:** (for example, the error is logged by a helper in another file, or this
failure is expected and harmless)

**Versions:**

- LogPilot version or commit (`node dist/cli.js --version`):
- Node.js version (`node --version`):
- Operating system:
