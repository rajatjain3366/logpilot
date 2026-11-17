// Tests for the guarantees in README.md, "What you can rely on" (Milestone T, v0.6.0).
// Each guarantee is checked by a test here or names the test file that checks it.
//
// - "A scan reads files and writes nothing (except --output), starts no program, needs no network":
//   the scan runs under Node's permission model, which refuses every file write and every child
//   process that was not allowed. If LogPilot tried, the scan would fail with ERR_ACCESS_DENIED.
// - "No network code": the source imports no network module (checked with the TypeScript parser).
// - "Same report on every OS": a fixed SHA-256 of the fixtures' JSON report; CI runs this on Linux
//   and Windows, so both must produce exactly these bytes.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = path.join(projectRoot, "dist", "cli.js");
const ALL_ON = ["--enable", "LP001", "--enable", "LP002", "--enable", "LP003"];
const FIXTURE_SCAN = ["scan", "test/fixtures", "--no-config", ...ALL_ON, "--fix-preview"];

/** Runs `node <nodeFlags> dist/cli.js <args>` from the project folder. */
function runNode(nodeFlags: string[], args: string[]) {
  const result = spawnSync(process.execPath, [...nodeFlags, cliPath, ...args], { cwd: projectRoot, encoding: "utf8" });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Node's permission model: reading is allowed everywhere; writing, child processes, workers, addons are refused. */
const READ_ONLY = ["--permission", "--allow-fs-read=*"];

describe("guarantee: a scan writes nothing and starts no program (Node permission model)", () => {
  it("gives the same text report under the permission model as without it", () => {
    const normal = runNode([], FIXTURE_SCAN);
    const restricted = runNode(READ_ONLY, FIXTURE_SCAN);

    expect(normal.exitCode).toBe(0);
    expect(normal.stdout).toContain("Proposed fix (preview only, not applied)"); // the scan did real work
    expect([restricted.exitCode, restricted.stderr]).toEqual([0, ""]);
    expect(restricted.stdout).toBe(normal.stdout);
  });

  it("writes --output when write access is granted for that one file only, and refuses it otherwise", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-perm-"));
    try {
      const target = path.join(dir, "report.json");
      const expected = runNode([], [...FIXTURE_SCAN, "--format", "json"]).stdout;

      const allowed = runNode([...READ_ONLY, `--allow-fs-write=${target}`], [...FIXTURE_SCAN, "--format", "json", "--output", target]);
      expect([allowed.exitCode, allowed.stdout, allowed.stderr]).toEqual([0, "", ""]);
      expect(readFileSync(target, "utf8")).toBe(expected);
      rmSync(target);

      const refused = runNode(READ_ONLY, [...FIXTURE_SCAN, "--format", "json", "--output", target]);
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toContain("could not write the report");
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("proves the permission model is really active: a program that writes is refused", () => {
    const writer = 'require("node:fs").writeFileSync(require("node:path").join(require("node:os").tmpdir(), "logpilot-should-not-exist.txt"), "x")';
    const result = spawnSync(process.execPath, [...READ_ONLY, "-e", writer], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERR_ACCESS_DENIED");
  });
});

/** Every module a source file loads: import/export ... from "x", import("x") and require("x"). */
function importedModules(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) found.push(ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : "<not a fixed string>");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Names used as values in a file (to find fetch, WebSocket, ...), ignoring text inside strings. */
function identifiers(file: string): Set<string> {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

describe("guarantee: no network code", () => {
  const srcDir = path.join(projectRoot, "src");
  const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts")).map((name) => path.join(srcDir, name));
  // The only modules LogPilot may load. None of them can open a network connection.
  const ALLOWED = new Set(["node:crypto", "node:fs", "node:path", "node:util", "typescript"]);

  it("loads only allowed modules (plus its own files); node:child_process only in git.ts, for `logpilot fix`", () => {
    expect(files.length).toBeGreaterThan(10);
    const problems: string[] = [];
    for (const file of files) {
      for (const name of importedModules(file)) {
        if (name.startsWith("./")) continue;
        if (name === "node:child_process" && path.basename(file) === "git.ts") continue;
        if (!ALLOWED.has(name)) problems.push(`${path.basename(file)}: ${name}`);
      }
    }
    expect(problems).toEqual([]);
  });

  // Also the ways to load a module without an import statement (process.getBuiltinModule,
  // createRequire, process.binding), which the check above would not see.
  const FORBIDDEN_NAMES = ["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "getBuiltinModule", "createRequire", "binding"];

  it("uses no global network API (fetch, WebSocket, ...) and no way around the import check", () => {
    const problems = files.flatMap((file) =>
      FORBIDDEN_NAMES.filter((name) => identifiers(file).has(name)).map((name) => `${path.basename(file)}: ${name}`),
    );
    expect(problems).toEqual([]);
  });

  it("finds a network import when there is one (the check itself works)", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "logpilot-net-"));
    try {
      const file = path.join(dir, "bad.ts");
      writeFileSync(
        file,
        'import https from "node:https";\nconst m = await import("node:net");\nexport const r = fetch("x");\nconst t = process.getBuiltinModule("node:tls");\n',
      );
      expect(importedModules(file)).toEqual(["node:https", "node:net"]);
      expect(identifiers(file).has("fetch")).toBe(true);
      expect(identifiers(file).has("getBuiltinModule")).toBe(true);
      expect(identifiers(file).has("https")).toBe(true); // names are found, but text inside strings is not:
      expect(identifiers(file).has("node:tls")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has exactly one runtime dependency: typescript", () => {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies)).toEqual(["typescript"]);
  });
});

describe("guarantee: the same report on every operating system", () => {
  // SHA-256 of `logpilot scan test/fixtures --no-config <all rules on> --fix-preview --format json`,
  // with the tool version replaced by "X" (so a version bump alone does not change it).
  // CI checks this on Linux and Windows. If a fixture or a rule changes on purpose, update the hash
  // and say so in the change (CHANGED ON PURPOSE), after checking the JSON diff.
  const GOLDEN = "49af3be51ee56cdb33bde3a63040ad0ba1d8cf8c6f9a39678b386a1819e3fdc0";

  it("gives byte-identical JSON for the fixtures (golden SHA-256)", () => {
    const { exitCode, stdout } = runNode([], [...FIXTURE_SCAN, "--format", "json"]);
    const version = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
    const normalized = stdout.replace(`"name": "logpilot",\n    "version": "${version}"`, '"name": "logpilot",\n    "version": "X"');

    expect(exitCode).toBe(0);
    expect(normalized).not.toBe(stdout); // the version really was replaced
    expect(createHash("sha256").update(normalized).digest("hex")).toBe(GOLDEN);
  });
});
