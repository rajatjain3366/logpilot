#!/usr/bin/env node
// LogPilot command-line entry point. This is the file the `logpilot` command runs
// (see "bin" in package.json). It reads the arguments, runs the scan, prints the
// report, and sets the exit code. All terminal input/output lives in this file.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { type Config, ConfigError, findConfigFile, loadConfig } from "./config.js";
import { checkExcludePattern } from "./file-selection.js";
import { unsupportedNodeVersion } from "./node-version.js";
import { formatReport } from "./report.js";
import { formatJson } from "./report-json.js";
import { RULES, scanPath, SOURCE_EXTENSIONS } from "./scanner.js";
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
  logpilot --help, -h              Show this help
  logpilot --version, -v           Show the version

Scan options:
  --config <file>          Use this config file instead of looking for logpilot.config.json
  --no-config              Do not use any config file
  --exclude <pattern>      Do not scan matching files or folders, e.g. "docs/**" (can be repeated;
                           adds to "exclude" in the config file)
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

Exit codes:
  0  the scan finished, and no finding is at or above --fail-on (by default: always)
  1  at least one finding is at or above --fail-on
  2  LogPilot could not run (bad arguments, invalid config file, path does not exist, ...)

Severity is not reliable yet: on code LogPilot was not tuned on, real problems got the same
severity as most findings that were not. Review findings of every severity before relying on
--fail-on.

A scan only reads files. It never modifies them.
`;

/** Reads our own version number from package.json (one folder above dist/). */
function readVersion(): string {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return packageJson.version;
}

/** A path as shown to the user: relative to the current folder, with "/" separators. */
function displayPath(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

/** Prints a usage error to stderr and returns the "tool error" exit code. */
function usageError(message: string): number {
  process.stderr.write(`Error: ${message}\nRun "logpilot --help" for usage.\n`);
  return EXIT_TOOL_ERROR;
}

/** Runs one CLI invocation and returns the exit code. */
function main(args: string[]): number {
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
        "min-severity": { type: "string" },
        "fail-on": { type: "string" },
        format: { type: "string" },
        output: { type: "string" },
        "fix-preview": { type: "boolean" },
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
  if (command !== "scan") {
    return usageError(`unknown command "${command}"`);
  }
  if (commandArgs.length > 1) {
    return usageError(`"scan" takes one path, but got ${commandArgs.length}: ${commandArgs.join(" ")}`);
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
  if (fixPreview && format === "json") {
    // The JSON report gets fixes with schema version 2; until then, refuse instead of leaving them out silently.
    return usageError("--fix-preview works only with the text format for now");
  }
  const output = parsed.values.output;
  if (output !== undefined && SOURCE_EXTENSIONS.has(path.extname(output).toLowerCase())) {
    // A typo such as "--output src/app.js" must never overwrite source code.
    return usageError(`--output "${output}": refusing to write a report into a JavaScript or TypeScript file; use for example report.json`);
  }

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

  let result;
  try {
    result = scanPath(target, process.cwd(), {
      // A command-line flag wins over the config file; --exclude adds to the config's list.
      defaultExcludes: parsed.values["no-default-excludes"] ? false : (config?.defaultExcludes ?? true),
      exclude: [...(config?.exclude ?? []), ...cliExcludes],
      // Patterns are relative to the config file's folder; without one, to the scanned folder.
      excludeRoot: configFile === undefined ? undefined : path.dirname(configFile),
      fixPreview,
    });
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
      rules: RULES.map((rule) => ({ id: rule.id, name: rule.name, version: rule.version })),
      config: {
        file: shownConfigFile ?? null,
        defaultExcludes: parsed.values["no-default-excludes"] ? false : (config?.defaultExcludes ?? true),
        exclude: [...(config?.exclude ?? []), ...cliExcludes],
        minSeverity,
        failOn,
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

try {
  // process.exitCode (instead of process.exit()) lets Node finish writing all output first.
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  // An uncaught crash would make Node exit with 1, which means "findings" for us. Use 2 instead.
  process.stderr.write(`LogPilot crashed unexpectedly (this is a bug, please report it):\n${(error as Error).stack}\n`);
  process.exitCode = EXIT_TOOL_ERROR;
}
