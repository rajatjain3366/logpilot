// Cross-checks docs/evaluation.md against the published evaluation data:
//   1. every labelled finding in a per-finding table has the label its label file gives, and every
//      labelled finding of a source is in the document;
//   2. the sealed labels equal the label files they were sealed from;
//   3. every published file has the SHA-256 listed in hashes.json, every hash cited in advance
//      appears in docs/evaluation.md, and unchanged files have exactly that cited hash.
// Optional: --mapping <file> (the private app-id mapping) also turns each anonymized copy back into
// the original and checks the original's SHA-256 against the cited one.
// Usage, from the repository root: node docs/eval-data/scripts/check-doc.mjs [--mapping <file>]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dataPath, readData, readDoc, sources, uniqueFindings } from "./lib.mjs";

const doc = readDoc();
const docText = doc.join("\n");
let problems = 0;
const problem = (message) => (problems++, console.log(`  PROBLEM ${message}`));

console.log("1. Per-finding tables against the label files");
for (const source of sources) {
  const labels = readData(source.labels);
  const rows = uniqueFindings(source, doc);
  for (const row of rows) if (labels[row.key] !== row.label) problem(`${row.key} (line ${row.line}): document says ${row.label}, label file says ${labels[row.key]}`);
  const listed = new Set(rows.map((row) => row.key));
  const missing = Object.keys(labels).filter((key) => !listed.has(key) && !(source.notListed && source.notListed.test(key)));
  for (const key of missing) problem(`${key} is labelled but not in the document`);
  console.log(`  ${source.name}: ${rows.length} findings checked, ${missing.length} missing`);
}

console.log("2. Sealed labels against the label files");
for (const [sealed, labelFile] of [
  ["sealed/second-labeller-claude-labels.json", "labels/labels-mongodb.json"],
  ["sealed/lp003-second-labeller-claude-labels.anon.json", "labels/labels-lp003-heldout.anon.json"],
]) {
  const labels = readData(labelFile);
  const entries = readData(sealed);
  const different = entries.filter((entry) => labels[entry.finding] !== entry.claudeLabel);
  for (const entry of different) problem(`${sealed}: ${entry.finding} sealed ${entry.claudeLabel}, label file ${labels[entry.finding]}`);
  console.log(`  ${sealed}: ${entries.length - different.length}/${entries.length} equal`);
}

console.log("3. File hashes");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mappingArg = process.argv.indexOf("--mapping");
const mapping = mappingArg === -1 ? undefined : JSON.parse(readFileSync(process.argv[mappingArg + 1], "utf8")).apps;
for (const entry of readData("hashes.json")) {
  const bytes = readFileSync(dataPath(entry.file));
  const hash = sha256(bytes);
  let note = hash === entry.sha256 ? "hash as listed" : (problem(`${entry.file}: SHA-256 ${hash}, hashes.json lists ${entry.sha256}`), "HASH DIFFERS");
  if (entry.citedSha256) {
    if (!docText.includes(entry.citedSha256)) problem(`${entry.file}: cited hash ${entry.citedSha256} is not in docs/evaluation.md`);
    if (!entry.anonymized) note += hash === entry.citedSha256 ? "; equals the hash cited in advance" : (problem(`${entry.file} differs from the cited hash`), "; DIFFERS from the cited hash");
    else if (mapping) {
      // Reverse the anonymization: "app-x" -> "owner__name", "App X" -> "owner/name".
      let text = bytes.toString("utf8");
      for (const app of mapping) text = text.replaceAll(app.slug, app.name.replace("/", "__")).replaceAll(new RegExp(`${app.id}(?![A-Za-z])`, "g"), app.name);
      const original = sha256(Buffer.from(text, "utf8"));
      note += original === entry.citedSha256 ? "; de-anonymized, equals the hash cited in advance" : (problem(`${entry.file}: de-anonymized hash ${original}`), "; de-anonymized: DIFFERS");
    } else note += "; anonymized copy (the cited hash needs the private mapping)";
  }
  console.log(`  ${entry.file}: ${note}`);
}

console.log(problems === 0 ? "OK: docs/evaluation.md matches the published evaluation data" : `${problems} problem(s)`);
process.exitCode = problems === 0 ? 0 : 1;
