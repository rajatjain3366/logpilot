# Beginner held-out set: selection protocol

Written before running the search. Goal: 3 small, real, public Express or MERN apps written in a
tutorial/student style, chosen by fixed rules so the choice cannot be bent towards good or bad results.

1. Search: GitHub repository search for the topic `mern-stack`, language JavaScript, sorted by
   most recently updated, first 50 results:
   `gh search repos --topic mern-stack --language JavaScript --sort updated --order desc --limit 50`
   The raw result list is saved next to this file (beginner-search-results.json), with the time of
   the search.
2. Walk the list in the order GitHub returns it. A repository is accepted only if ALL of these hold,
   checked in this order on a shallow clone (`git clone --depth 1`), without running LogPilot:
   a. not a fork and not archived;
   b. at most one repository per owner (the first one from an owner counts);
   c. it has an Express backend: some `package.json` lists `express` in `dependencies`;
   d. it is small: 5 to 200 JavaScript/TypeScript files that LogPilot would scan
      (same rules as LogPilot: skip node_modules, dist and .git folders and .d.ts files);
   e. it contains at least one `try { ... } catch` (both rules only look at try/catch, so a
      repository without any cannot produce findings to label).
3. Stop at the first 3 accepted repositories. Every repository looked at is listed with the reason
   it was skipped or accepted.
4. Only then scan the 3 accepted repositories with LogPilot (the current, round-2 version) and
   label every finding (systematic sampling only if a repository has more than 30).
