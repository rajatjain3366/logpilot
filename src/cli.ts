#!/usr/bin/env node
// LogPilot command-line entry point. This is the file the `logpilot` command runs
// (see "bin" in package.json). It reads the arguments, runs the scan (or `fix`), prints the
// report, and sets the exit code. Terminal output lives here; for `fix`, reading the user's
// answers lives in prompt.ts.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { enabledRuleIds, KNOWN_RULE_IDS } from "./analyze.js";
import { type Config, ConfigError, findConfigFile, loadConfig } from "./config.js";
import { checkExcludePattern } from "./file-selection.js";
import { unsupportedNodeVersion } from "./node-version.js";
import { FIX_EXIT, type FixRunOptions, runFix } from "./fix-command.js";
import { Prompt } from "./prompt.js";
import { formatReport, reportWidth } from "./report.js";
import { formatJson } from "./report-json.js";
import { RULES, scanPath, scanRootOf, SOURCE_EXTENSIONS, toDisplayPath } from "./scanner.js";
import {
  checkLevels,
  DEFAULT_FAIL_ON,
  DEFAULT_MIN_SEVERITY,
  FAIL_ON_LEVELS,
  isFailOn,
  isSeverity,
  SEVERITIES,
  severityRank,
} from "./severity.js";

// Exit codes: the number a program hands back to the shell when it finishes.
// Scripts and CI read this number; people read the text output.
const EXIT_OK = 0; //            the scan finished, and no finding is at or above --fail-on
const EXIT_FAILED_ON = 1; //     at least one finding is at or above --fail-on
const EXIT_TOOL_ERROR = 2; //    LogPilot could not run

const HELP = `LogPilot - finds code that would leave you without evidence when it fails in production.

Usage:
  logpilot scan [path] [options]   Scan a folder or a single file (default: the current folder)
  logpilot fix [path] [options]    Show each LP003 fix and ask you; write a file only after you answer y
  logpilot --help, -h              Show this help
  logpilot --version, -v           Show the version

Scan options:
  --config <file>          Use this config file instead of looking for logpilot.config.json
  --no-config              Do not use any config file
  --exclude <pattern>      Do not scan matching files or folders, e.g. "docs/**" (can be repeated;
                           adds to "exclude" in the config file)
  --enable <rule>          Turn on a rule that is off by default, e.g. --enable LP001 (can be
                           repeated; wins over "rules" in the config file)
  --show-skipped           List every file and folder that was not scanned, and why
  --no-default-excludes    Also scan build output, third-party folders, minified and vendored files
                           (node_modules and .git are never scanned)
  --min-severity <level>   Show only findings at or above low | medium | high (default: low)
  --fail-on <level>        Exit with 1 if a finding is at or above none | low | medium | high
                           (default: none, so findings alone never fail the scan)
  --format <text|json>     Report format (default: text). JSON includes warnings and skipped paths
  --output <file>          Write the report to this file instead of the terminal
  --fix-preview            Show a proposed fix (a diff) under each LP003 finding. A preview only:
                           LogPilot never changes your files
  --verbose                Show every finding in full (by default, findings with the same pattern
                           are listed under the first one, and later findings of the same kind
                           refer back to the first one)

Rules: LP001 empty-catch (off by default), LP002 lost-error-cause, LP003 unlogged-error-response.

Fix options: --config, --no-config, --exclude, --no-default-excludes (as for scan), and
  --output <file>          Write a JSON record of the run (what was written, declined, skipped)
  logpilot fix asks before every change (y = yes, n = no, s = skip the rest of the file, q = quit),
  so it must run in a terminal. It only changes files that git tracks and that have no
  uncommitted changes, so every change can be undone with git (it prints the commands).

Exit codes of scan:
  0  the scan finished, and no finding is at or above --fail-on (by default: always)
  1  at least one finding is at or above --fail-on
  2  LogPilot could not run (bad arguments, invalid config file, path does not exist, ...)
Exit codes of fix:
  0  finished: every fix you accepted was written (also after q)
  1  at least one fix you accepted was not written (the file changed, was locked, or failed a check)
  2  LogPilot could not run, or stopped because a file needs your attention
  130  stopped by Ctrl+C

Severity is not reliable yet: on code LogPilot was not tuned on, real problems got the same
severity as most findings that were not. Review findings of every severity before relying on
--fail-on.

A scan only reads files. It never modifies them.
`;

/** The refusal when `logpilot fix` has no terminal to ask in (finalized at Milestone 4, Checkpoint 2). */
export const NOT_A_TERMINAL =
  "logpilot fix asks you before every change, so it must run directly in a terminal window, without |, < or > around it. Nothing was changed.";

/** Options that only `scan` has: `fix` refuses them, so a typo cannot silently do something else. */
const SCAN_ONLY_OPTIONS = ["show-skipped", "min-severity", "fail-on", "format", "fix-preview", "verbose"] as const;

/** Reads our own version number from package.json (one folder above dist/). */
function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

/** Prints a usage error to stderr and returns the "tool error" exit code. */
function usageError(message: string): number {
  process.stderr.write(`Error: ${message}\nRun "logpilot --help" for usage.\n`);
  return EXIT_TOOL_ERROR;
}

/** Runs one CLI invocation and returns the exit code (`fix` asks questions, so it may have to wait). */
function main(args: string[]): number | Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        "show-skipped": { type: "boolean" },
        "no-default-excludes": { type: "boolean" },
        config: { type: "string" },
        "no-config": { type: "boolean" },
        exclude: { type: "string", multiple: true },
        enable: { type: "string", multiple: true },
        "min-severity": { type: "string" },
        "fail-on": { type: "string" },
        format: { type: "string" },
        output: { type: "string" },
        "fix-preview": { type: "boolean" },
        verbose: { type: "boolean" },
      },
      allowPositionals: true, // positionals = plain words like "scan" and the path
    });
  } catch (error) {
    return usageError((error as Error).message); // e.g. an unknown --flag
  }

  if (parsed.values.help) {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  if (parsed.values.version) {
    process.stdout.write(`${readVersion()}\n`);
    return EXIT_OK;
  }

  const [command, ...commandArgs] = parsed.positionals;
  if (command === undefined) {
    // Not exit 0: a CI script that forgot the command must not look like a clean scan.
    process.stderr.write(`Error: no command given.\n\n${HELP}`);
    return EXIT_TOOL_ERROR;
  }
  if (command !== "scan" && command !== "fix") {
    return usageError(`unknown command "${command}"`);
  }
  if (commandArgs.length > 1) {
    return usageError(`"${command}" takes one path, but got ${commandArgs.length}: ${commandArgs.join(" ")}`);
  }
  if (command === "fix") {
    const scanOnly = SCAN_ONLY_OPTIONS.find((option) => parsed.values[option] !== undefined);
    if (scanOnly !== undefined) return usageError(`--${scanOnly} is an option of "scan", not of "fix"`);
    // Before anything else: without a terminal nobody can answer, and nothing may be written.
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
      process.stderr.write(`Error: ${NOT_A_TERMINAL}\n`);
      return EXIT_TOOL_ERROR;
    }
  }

  const unsupported = unsupportedNodeVersion(process.versions.node);
  if (unsupported !== undefined) {
    process.stderr.write(`Error: ${unsupported}\n`);
    return EXIT_TOOL_ERROR;
  }

  const target = commandArgs[0] ?? ".";
  if (parsed.values.config !== undefined && parsed.values["no-config"]) {
    return usageError("use either --config or --no-config, not both");
  }
  const cliExcludes = parsed.values.exclude ?? [];
  for (const pattern of cliExcludes) {
    const problem = checkExcludePattern(pattern);
    if (problem !== undefined) return usageError(`--exclude "${pattern}": ${problem}`);
  }
  const cliEnable = parsed.values.enable ?? [];
  for (const id of cliEnable) {
    if (!KNOWN_RULE_IDS.includes(id)) return usageError(`--enable "${id}": unknown rule (known rules: ${KNOWN_RULE_IDS.join(", ")})`);
  }
  const cliMinSeverity = parsed.values["min-severity"];
  if (cliMinSeverity !== undefined && !isSeverity(cliMinSeverity)) {
    return usageError(`--min-severity must be one of ${SEVERITIES.join(", ")} (got "${cliMinSeverity}")`);
  }
  const cliFailOn = parsed.values["fail-on"];
  if (cliFailOn !== undefined && !isFailOn(cliFailOn)) {
    return usageError(`--fail-on must be one of ${FAIL_ON_LEVELS.join(", ")} (got "${cliFailOn}")`);
  }
  const format = parsed.values.format ?? "text";
  if (format !== "text" && format !== "json") {
    return usageError(`--format must be text or json (got "${format}")`);
  }
  const fixPreview = parsed.values["fix-preview"] === true;
  const output = parsed.values.output;
  if (output !== undefined && SOURCE_EXTENSIONS.has(path.extname(output).toLowerCase())) {
    // A typo such as "--output src/app.js" must never overwrite source code.
    return usageError(`--output "${output}": refusing to write a report into a JavaScript or TypeScript file; use for example report.json`);
  }

  // Every path LogPilot prints is relative to the scanned folder (for a single file: its folder),
  // whichever folder or drive LogPilot is run from. The config file's path too.
  const scanRoot = scanRootOf(path.resolve(target));
  const displayPath = (file: string) => toDisplayPath(file, scanRoot);

  // The config file: --config names it, --no-config turns it off, otherwise LogPilot looks for it.
  let configFile: string | undefined;
  let config: Config | undefined;
  try {
    if (parsed.values.config !== undefined) {
      configFile = path.resolve(parsed.values.config);
      if (!existsSync(configFile)) throw new ConfigError(`config file "${parsed.values.config}" does not exist`);
    } else if (!parsed.values["no-config"] && existsSync(target)) {
      configFile = findConfigFile(path.resolve(target));
    }
    config = configFile === undefined ? undefined : loadConfig(configFile, displayPath(configFile));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    process.stderr.write(`Error: ${error.message}\n`);
    return EXIT_TOOL_ERROR;
  }

  // Command-line options win over the config file.
  const minSeverity = cliMinSeverity ?? config?.minSeverity ?? DEFAULT_MIN_SEVERITY;
  const failOn = cliFailOn ?? config?.failOn ?? DEFAULT_FAIL_ON;
  const levelProblem = checkLevels(minSeverity, failOn);
  if (levelProblem !== undefined) {
    process.stderr.write(`Error: ${levelProblem}\n`);
    return EXIT_TOOL_ERROR;
  }
  // Which rules run: the defaults, then the config file's "rules", then --enable.
  const configRules = config?.rules ?? {};
  const enabledRules = enabledRuleIds(configRules, cliEnable);
  // Rules that are off only because nobody turned them on: the summary says so, with how to turn them on.
  const offByDefault = RULES.filter((rule) => !rule.defaultEnabled && !enabledRules.has(rule.id) && configRules[rule.id] === undefined).map(
    (rule) => ({ id: rule.id, name: rule.name, reason: rule.offByDefaultReason ?? "" }),
  );
  const fileSelection = {
    // A command-line flag wins over the config file; --exclude adds to the config's list.
    defaultExcludes: parsed.values["no-default-excludes"] ? false : (config?.defaultExcludes ?? true),
    exclude: [...(config?.exclude ?? []), ...cliExcludes],
    // Patterns are relative to the config file's folder; without one, to the scanned folder.
    excludeRoot: configFile === undefined ? undefined : path.dirname(configFile),
    enabledRules,
  };
  if (command === "fix") return fix(target, fileSelection, output);

  let result;
  try {
    result = scanPath(target, process.cwd(), { ...fileSelection, fixPreview });
  } catch (error) {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    return EXIT_TOOL_ERROR;
  }

  // --min-severity decides what is shown; --fail-on decides the exit code. checkLevels() made sure
  // fail-on is not below min-severity, so a finding that is not shown can never fail the scan.
  const shown = result.findings.filter((f) => severityRank(f.severity) >= severityRank(minSeverity));
  const fails = failOn !== "none" && shown.some((f) => severityRank(f.severity) >= severityRank(failOn));
  const exitCode = fails ? EXIT_FAILED_ON : EXIT_OK;
  const shownConfigFile = configFile === undefined ? undefined : displayPath(configFile);

  let report: string;
  if (format === "json") {
    // Warnings are inside the JSON, so stdout (or the --output file) is the only thing to read.
    report = formatJson(result, {
      toolVersion: readVersion(),
      rules: RULES.map((rule) => ({ id: rule.id, name: rule.name, version: rule.version, enabled: enabledRules.has(rule.id) })),
      config: {
        file: shownConfigFile ?? null,
        defaultExcludes: parsed.values["no-default-excludes"] ? false : (config?.defaultExcludes ?? true),
        exclude: [...(config?.exclude ?? []), ...cliExcludes],
        minSeverity,
        failOn,
        fixPreview,
      },
      shown,
      hiddenBelowMinSeverity: result.findings.length - shown.length,
      exitCode,
    });
  } else {
    // Warnings go to stderr, the report to stdout, so `logpilot scan . > report.txt`
    // saves only the report while warnings still show on screen.
    for (const warning of result.warnings) {
      process.stderr.write(`Warning: ${warning.message}\n`);
    }
    report = formatReport(
      { ...result, findings: shown },
      {
        showSkipped: parsed.values["show-skipped"],
        configFile: shownConfigFile,
        hiddenBelowMinSeverity: result.findings.length - shown.length,
        minSeverity,
        fixPreview,
        offByDefault,
        verbose: parsed.values.verbose === true,
        // In a terminal, wrap at its width (so words are not cut in the middle); otherwise at 100.
        width: reportWidth(process.stdout, output !== undefined),
      },
    );
  }

  if (output === undefined) {
    process.stdout.write(report);
  } else {
    try {
      writeFileSync(output, report);
    } catch (error) {
      process.stderr.write(`Error: could not write the report to "${output}": ${(error as Error).message}\n`);
      return EXIT_TOOL_ERROR;
    }
  }
  return exitCode;
}

/**
 * `logpilot fix`: the terminal (prompt.ts) and the run (fix-command.ts). The terminal is in raw
 * mode only while the run lasts, and is always given back, also after a crash.
 */
async function fix(target: string, scanOptions: FixRunOptions["scanOptions"], output: string | undefined): Promise<number> {
  const prompt = new Prompt(process.stdin, process.stdout);
  const onSignal = () => prompt.signal(); // a real SIGINT (in raw mode, Ctrl+C arrives as a key instead)
  process.on("SIGINT", onSignal);
  process.once("exit", () => prompt.stop());
  prompt.start();
  let result;
  try {
    result = await runFix({ target, cwd: process.cwd(), scanOptions, io: prompt, toolVersion: readVersion() });
  } finally {
    prompt.stop();
    process.off("SIGINT", onSignal);
  }
  if (result.error !== undefined) process.stderr.write(`Error: ${result.error}\n`);
  if (output !== undefined && result.record !== undefined) {
    try {
      writeFileSync(output, `${JSON.stringify(result.record, null, 2)}\n`);
    } catch (error) {
      // The fixes themselves were handled as reported above; only the record is missing.
      process.stderr.write(`Error: could not write the run record to "${output}": ${(error as Error).message}\n`);
      return result.exitCode === FIX_EXIT.INTERRUPTED ? result.exitCode : EXIT_TOOL_ERROR;
    }
  }
  return result.exitCode;
}

/** An uncaught crash would make Node exit with 1, which means "findings" for us. Use 2 instead. */
function crashed(error: unknown): void {
  process.stderr.write(`LogPilot crashed unexpectedly (this is a bug, please report it):\n${(error as Error).stack}\n`);
  process.exitCode = EXIT_TOOL_ERROR;
}

try {
  // process.exitCode (instead of process.exit()) lets Node finish writing all output first.
  const exitCode = main(process.argv.slice(2));
  if (typeof exitCode === "number") process.exitCode = exitCode;
  else exitCode.then((code) => (process.exitCode = code), crashed);
} catch (error) {
  crashed(error);
}
