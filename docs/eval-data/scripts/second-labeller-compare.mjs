// Recomputes the two blind second-labeller checks in docs/evaluation.md: agreement and Cohen's kappa
// between Claude's sealed labels and the second labeller's labels.
// Usage, from the repository root: node docs/eval-data/scripts/second-labeller-compare.mjs
import { kappa, readData } from "./lib.mjs";

const checks = [
  ["Round 2 (MongoDB driver)", "sealed/second-labeller-claude-labels.json", "second-labeller/round2-owner-labels.json"],
  ["LP003 (held-out Express apps)", "sealed/lp003-second-labeller-claude-labels.anon.json", "second-labeller/lp003-owner-labels.anon.json"],
];
for (const [name, sealedFile, ownerFile] of checks) {
  const sealed = readData(sealedFile);
  const owner = new Map(readData(ownerFile).map((o) => [o.finding, o.label]));
  const claude = sealed.map((s) => s.claudeLabel);
  const theirs = sealed.map((s) => owner.get(s.finding));
  if (theirs.includes(undefined)) throw new Error(`${ownerFile} does not label every sealed finding`);
  const binary = (labels) => labels.map((l) => (l === "TP" ? "TP" : "not TP"));
  const three = kappa(claude, theirs);
  const two = kappa(binary(claude), binary(theirs));
  const agree = (a, b) => a.filter((x, i) => x === b[i]).length;
  console.log(`\n${name}`);
  sealed.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)} Claude ${claude[i].padEnd(9)} second ${theirs[i].padEnd(9)} ${claude[i] === theirs[i] ? "agree" : "DISAGREE"}  ${s.finding}`));
  console.log(`  3 labels: ${agree(claude, theirs)}/10, chance agreement ${three.chance.toFixed(2)}, kappa ${three.kappa.toFixed(2)}`);
  console.log(`  TP vs not TP: ${agree(binary(claude), binary(theirs))}/10, chance agreement ${two.chance.toFixed(2)}, kappa ${two.kappa.toFixed(2)}`);
}
