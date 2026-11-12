# LogPilot evaluation data

The data behind the numbers in [../evaluation.md](../evaluation.md), so that anyone can check
them. It is not part of LogPilot itself.

**What is here:** the hand-made labels, the sealed files, the selection protocols, the second
labellers' labels, and scripts that check the evaluation document against them and recompute its
numbers.

**What is not here, on purpose:**

- LogPilot's scan output;
- the code samples read for the recall estimate;
- the raw GitHub search results;
- anything else that contains code or lists from the evaluated projects.

## Student and beginner apps are anonymized

The 20 small Express/MERN apps are called **App A to App T**, to avoid publicly labelling
students' code:

- in finding keys, the clone folder `owner__name` became `app-x`, for example
  `app-p/backend/routes/auth.js:92`;
- in text, `owner/name` became `App X`.

The mapping to real names, URLs and pinned commits is kept privately by the project owner. The
mature open-source projects (Express, Vite, Mongoose, the MongoDB Node.js driver, knex,
node-postgres) keep their real names.

## Files

| File | What it is |
|---|---|
| `labels/labels-*.json` | One label (TP / Debatable / FP) per labelled finding, keyed by `project/path:line`. `.anon` files belong to anonymized apps. |
| `sealed/second-labeller-claude-labels.json` | Claude's labels for the round-2 second-labeller check, sealed before the second labelling. Unchanged. |
| `sealed/lp003-second-labeller-claude-labels.anon.json` | The same for the LP003 check. Anonymized copy. |
| `sealed/lp003-recall-classification.anon.json` | The 60 candidate catches classified by hand before LP003's held-out scan (instance or not, and why). No code. Anonymized copy. |
| `protocols/beginner-selection-protocol.md` | How the round-2 beginner apps were chosen. Unchanged. |
| `protocols/lp003-selection-protocol.anon.md` | How the LP003 apps were chosen and split. Anonymized copy. |
| `second-labeller/round2-owner-labels.json` | The project owner's blind labels for the round-2 check. They were first recorded inside a comparison script; this file holds the same 10 labels. |
| `second-labeller/lp003-owner-labels.anon.json` | The project owner's blind labels and reasons for the LP003 check. |
| `hashes.json` | SHA-256 of every file above. For anonymized copies it also gives the original's hash, and the hash cited in advance where there is one. |
| `scripts/` | The scripts below. |

## Sealed files and their hashes

Four SHA-256 hashes were published in `evaluation.md` before the step they guard. See the table in
[Evaluation data and anonymized apps](../evaluation.md#evaluation-data-and-anonymized-apps).

- **`sealed/second-labeller-claude-labels.json` is published unchanged.** Its SHA-256 is the cited
  `054b7661…`.
- **The other three originals name student apps, so they are published only as anonymized
  copies.**
  - The originals were not edited.
  - Each copy differs only by the name replacement described above, so it has a different hash.
  - Reversing the replacement with the private mapping gives the original bytes, whose SHA-256 is
    the cited one. `check-doc.mjs --mapping <file>` does exactly that.
  - Without the mapping, you can check each copy against `hashes.json` and against every label and
    number in `evaluation.md`, but not the cited hash itself.

## Scripts

Run them from the repository root with Node.js 22.20 or newer. They need no `npm install`.

```bash
node docs/eval-data/scripts/check-doc.mjs                # evaluation.md tables vs labels, sealed files, hashes
node docs/eval-data/scripts/precision.mjs                # precision per round, severity, LP003 case and view
node docs/eval-data/scripts/second-labeller-compare.mjs  # agreement and Cohen's kappa of both checks
```

They read the per-finding tables in `evaluation.md` (location, level, LP003 case) and the label
files here. They never read scan output.

- **Round 1 (Vite, Mongoose)** is history: only its label files are here. Its findings are listed
  in `evaluation.md` in a different table layout, and the scripts do not recompute it.
- **The MongoDB driver's 258 findings in vendored libraries** are labelled in `labels-mongodb.json`
  but listed in `evaluation.md` only as one group. So the scripts recompute the driver's numbers
  for its own code (30 findings).
