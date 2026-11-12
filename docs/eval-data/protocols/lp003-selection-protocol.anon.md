# LP003 evaluation: selection protocol (Milestone 2.5)

Written before running any search. Its SHA-256 is recorded before the first search runs.
Goal: a tuning set and a separate held-out set of beginner/intermediate Express or MERN apps,
chosen by fixed rules so the choice cannot be bent towards good or bad results.

## 1. Search

Four GitHub repository searches, run once, in this order, each saved raw (with the time of the
search) as `lp003-search-<n>.json`:

1. `gh search repos --topic mern-stack --language JavaScript --sort updated --order desc --limit 100`
2. `gh search repos --topic mern-stack --language TypeScript --sort updated --order desc --limit 100`
3. `gh search repos --topic express --language JavaScript --sort updated --order desc --limit 100`
4. `gh search repos --topic express --language TypeScript --sort updated --order desc --limit 100`

JSON fields requested: `fullName,owner,isFork,isArchived,url,updatedAt`.

**Walk order:** round-robin over the four lists (1st of list 1, 1st of list 2, 1st of list 3,
1st of list 4, 2nd of list 1, ...), skipping a repository already seen earlier in the walk.

## 2. Acceptance

A repository is accepted only if ALL of these hold, checked in this order on a shallow clone
(`git clone --depth 1`) of its default branch, **without running LogPilot's rules**:

a. not a fork and not archived (from the search result);
b. at most one repository per owner (the first one from an owner in the walk counts);
c. not used in any earlier LogPilot evaluation: not one of the four repositories examined in
   round 2 (`App A`, `App B`,
   `App D`, `App C`), and not one of the library
   repositories (express, vite, mongoose, node-mongodb-native, knex, node-postgres);
d. some `package.json` outside `node_modules` lists `express` in `dependencies`;
e. 5 to 300 files that LogPilot would scan, counted with LogPilot's own file-selection functions
   (`dist/file-selection.js`: default folder skips, minified and vendored files, `.d.ts` files);
   no rule is run;
f. at least one "candidate catch": in a scannable file, a line matching `\bcatch\s*[({]` followed,
   on that line or within the next 10 lines, by a line matching `\bres\.`. Only the number of
   candidates is recorded; their code is not printed.

**Groups** (a proxy for beginner vs intermediate size): *small* = 5-60 scannable files,
*medium* = 61-300. The walk continues until both groups have 8 accepted repositories or the list
ends. A repository that passes a-f but whose group is already full is recorded as "group full"
and not used. Every repository looked at is recorded in `lp003-walk.txt` with its commit SHA,
its counts, and the reason it was accepted or skipped.

## 3. Split (deterministic)

Within each group, sort the accepted repositories by the SHA-256 (hex) of their full name
`owner/name` as returned by the search, ascending. The first 2 go to the **tuning set**, the next
6 to the **held-out set**. The tuning set also includes the 3 round-2 apps (already tuning data).
Every accepted repository is pinned at the commit SHA of its shallow clone.

## 4. After selection (fixed now, before any LP003 code exists)

1. LP003 is designed and tuned only on the tuning set (4 new apps + 3 round-2 apps).
2. LP003 is then frozen: the SHA-256 of `git diff HEAD -- src` is recorded.
3. The 12 held-out apps are scanned once with the frozen version. All LP003 findings are labelled
   (systematic sample if a repository has more than 30). Precision is reported per severity and
   per case A-E. No rule change after this point; only reporting and recommendations.
4. **Recall estimate:** in the held-out apps, every candidate catch (rule f above) is read and
   classified by hand as an LP003 instance or not, BEFORE looking at which ones LP003 reported.
   An LP003 instance: the catch is inside a request handler or error middleware, sends an error
   response, and the caught error is not logged, passed on, rethrown or given to another function.
   If there are more than 60 candidates in total, a systematic sample of 60 is classified (every
   k-th candidate in path and line order, k = total / 60, positions floor((i + 0.5) * k)).
   Recall estimate = instances reported by LP003 / instances classified. This only covers
   catches whose response is within 10 lines; it says nothing about other shapes.
5. **Second-labeller sample (10 held-out findings):** groups = case (A-E) x severity; a group of
   n findings out of N gets k = max(1, round(10 * n / N)) picks; if the total is not 10, add to or
   remove from the largest groups (ties: earlier case letter) until it is 10. Within a group, in
   report order, pick positions floor((i + 0.5) * n / k). The list is sorted by file path. Claude's
   labels for these 10 are sealed in a file whose SHA-256 is published before the second labelling.
