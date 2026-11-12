// Shared helpers for the evaluation scripts in this folder (NOT part of LogPilot itself).
// They read only files published in this repository: docs/evaluation.md and docs/eval-data/.
import { readFileSync } from "node:fs";

const dataDir = new URL("../", import.meta.url);
export const readData = (path) => JSON.parse(readFileSync(new URL(path, dataDir), "utf8"));
export const dataPath = (path) => new URL(path, dataDir);
export const docPath = new URL("../../evaluation.md", import.meta.url);
export const readDoc = () => readFileSync(docPath, "utf8").split(/\r?\n/);

/**
 * The projects whose findings are listed one by one in docs/evaluation.md, with their label file.
 * A finding's key is "<prefix><path inside the project>:<line>", the key used in the label file.
 * Mature projects are linked (`repo` + pinned `sha`); anonymized apps appear as "App X: path:line".
 */
export const sources = [
  { name: "MongoDB driver (round 2)", repo: "mongodb/node-mongodb-native", sha: "a255151d4d638cd4ffd807883d1b24f46d426278", prefix: "node-mongodb-native/", labels: "labels/labels-mongodb.json",
    // Vendored libraries in the driver's documentation site are labelled as one group, not listed.
    notListed: /^node-mongodb-native\/(docs|etc)\// },
  { name: "App A (round 2)", apps: ["App A"], prefix: (app) => `beginner/${slug(app)}/`, labels: "labels/labels-app-a.anon.json" },
  { name: "knex (round 3)", repo: "knex/knex", sha: "e25d54bcb707714a17f5a5744eba5c4246bb4d1d", prefix: "knex/", labels: "labels/labels-knex.json" },
  { name: "node-postgres (round 3)", repo: "brianc/node-postgres", sha: "2a5850fb0db18f5e40a642bbb4a4743de412ab54", prefix: "node-postgres/", labels: "labels/labels-node-postgres.json" },
  { name: "LP003 held-out (12 apps)", apps: "IJKLMNOPQRST".split("").map((l) => `App ${l}`), prefix: (app) => `${slug(app)}/`, labels: "labels/labels-lp003-heldout.anon.json" },
];
const slug = (app) => app.toLowerCase().replace(" ", "-");

const LABEL = /^(TP|FP|Debatable)$/;
const LEVEL = /^(high|medium|low)\/(high|medium|low)$/;

/**
 * Every table row in docs/evaluation.md that names a finding of `source`, as
 * { key, line, label, severity, confidence, case, rule }. `label` is the first cell that is exactly
 * TP, FP or Debatable (in the second-labeller tables that is Claude's sealed label).
 */
export function findingRows(source, doc = readDoc()) {
  const rows = [];
  doc.forEach((text, index) => {
    if (!text.startsWith("| ")) return;
    let key;
    if (source.repo) {
      const link = text.match(new RegExp(`\\]\\(https://github\\.com/${source.repo}/blob/${source.sha}/([^#)]+)#L(\\d+)\\)`));
      if (link) key = `${source.prefix}${link[1]}:${link[2]}`;
    } else {
      const plain = text.match(/\| (App [A-T]): ([^|]+?):(\d+) \|/);
      if (plain && source.apps.includes(plain[1])) key = `${source.prefix(plain[1])}${plain[2]}:${plain[3]}`;
    }
    if (key === undefined) return;
    const cells = text.split(" | ").map((cell) => cell.replace(/^\|\s*|\s*\|$/g, "").trim());
    const label = cells.find((cell) => LABEL.test(cell));
    if (label === undefined) return; // e.g. a list of findings without labels
    const level = cells.find((cell) => LEVEL.test(cell))?.split("/");
    rows.push({
      key,
      line: index + 1,
      label,
      severity: level?.[0],
      confidence: level?.[1],
      case: cells.find((cell) => /^[A-E]$/.test(cell)),
      rule: cells.find((cell) => /^LP00\d$/.test(cell)) ?? (source.name.startsWith("LP003") ? "LP003" : undefined),
    });
  });
  return rows;
}

/** One row per finding (the first table row that names it), with every key checked for consistent levels. */
export function uniqueFindings(source, doc = readDoc()) {
  const byKey = new Map();
  for (const row of findingRows(source, doc)) {
    const first = byKey.get(row.key);
    if (first === undefined) byKey.set(row.key, row);
    else if (row.severity && first.severity && (row.severity !== first.severity || row.confidence !== first.confidence)) {
      throw new Error(`${row.key}: level ${row.severity}/${row.confidence} on line ${row.line}, but ${first.severity}/${first.confidence} on line ${first.line}`);
    }
  }
  return [...byKey.values()];
}

/** Cohen's kappa for two labellers over the same items. */
export function kappa(a, b) {
  const n = a.length;
  const categories = [...new Set([...a, ...b])];
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const chance = categories.reduce((sum, c) => sum + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return { observed, chance, kappa: chance === 1 ? (observed === 1 ? 1 : 0) : (observed - chance) / (1 - chance) };
}
