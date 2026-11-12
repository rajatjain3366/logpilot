// Recomputes the precision numbers in docs/evaluation.md from its per-finding tables (levels and
// LP003 cases) and the published label files. Precision = TP / labelled findings; "Debatable" counts
// as not TP. Usage, from the repository root: node docs/eval-data/scripts/precision.mjs
import { readData, readDoc, sources, uniqueFindings } from "./lib.mjs";

const doc = readDoc();
const findings = (name) => {
  const source = sources.find((s) => s.name === name);
  const labels = readData(source.labels);
  return uniqueFindings(source, doc).map((row) => ({ ...row, label: labels[row.key] }));
};
const tally = (rows, isTP = (r) => r.label === "TP") => {
  if (rows.length === 0) return "no findings";
  const tp = rows.filter(isTP).length;
  const deb = rows.filter((r) => !isTP(r) && r.label === "Debatable").length;
  return `${tp}/${rows.length} (${Math.round((100 * tp) / rows.length)}%)  [TP ${tp} / Debatable ${deb} / FP ${rows.length - tp - deb}]`;
};
const print = (title, rows, groups) => {
  console.log(`\n${title}`);
  for (const [label, filter] of groups) console.log(`  ${label.padEnd(22)} ${tally(rows.filter(filter))}`);
};
const bySeverity = [["high", (r) => r.severity === "high"], ["medium", (r) => r.severity === "medium"], ["low", (r) => r.severity === "low"], ["all", () => true]];

// Round 2: MongoDB driver (its own code; the 258 vendored findings are labelled as one FP group) and App A.
print("Round 2: MongoDB driver, its own code", findings("MongoDB driver (round 2)"), bySeverity);
print("Round 2: App A (beginner)", findings("App A (round 2)"), bySeverity);

// Round 3: LP001 version 2 on knex and node-postgres.
const round3 = [...findings("knex (round 3)"), ...findings("node-postgres (round 3)")];
print("Round 3: LP001 v2, knex + node-postgres", round3, bySeverity);

// LP003 held-out, as measured with version 1.
const lp003 = findings("LP003 held-out (12 apps)");
print("LP003 held-out (version 1)", lp003, [
  ...bySeverity.slice(0, 3),
  ...["A", "B", "C", "D", "E"].map((c) => [`case ${c}`, (r) => r.case === c]),
  ["confidence high", (r) => r.confidence === "high"],
  ["confidence medium", (r) => r.confidence === "medium"],
  ["all", () => true],
]);

// LP003 under three views of the second-labeller check.
const second = new Map(readData("second-labeller/lp003-owner-labels.anon.json").map((o) => [o.finding, o.label]));
const views = {
  "view 1 (Claude)": (r) => r.label === "TP",
  "view 2 (second labeller wins)": (r) => (second.has(r.key) ? second.get(r.key) : r.label) === "TP",
  "view 3 (TP only if both)": (r) => r.label === "TP" && (!second.has(r.key) || second.get(r.key) === "TP"),
};
console.log("\nLP003 held-out, three views");
for (const [name, isTP] of Object.entries(views)) {
  const cell = (rows) => tally(rows, isTP).split("  [")[0];
  console.log(`  ${name.padEnd(30)} all ${cell(lp003).padEnd(12)} high ${cell(lp003.filter((r) => r.severity === "high")).padEnd(12)} case E ${cell(lp003.filter((r) => r.case === "E")).padEnd(12)} double-labelled ${cell(lp003.filter((r) => second.has(r.key)))}`);
}
