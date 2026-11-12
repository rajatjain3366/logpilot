// Logger detection for fix previews: which logger a fix should call, and in which form.
// Reads syntax trees only. To look one step into a relative import (./utils/logger), it asks the
// caller for that file's text: this module never touches the disk itself.
//
// The order (the first that applies wins):
//   1. The file creates a logger at its top level: pino(), winston.createLogger(), bunyan.createLogger(),
//      or a .child() of one.                                         -> that library's form
//   2. The file imports a binding from a relative module, and that module (read one step deep, never
//      further) creates and exports a pino/winston/bunyan logger.     -> that library's form
//   3. The file imports a logger-like binding (logger, log, appLogger, ...) whose library is unknown,
//      and already calls <binding>.error(...) with a caught error.    -> a copy of that call's form
//   4. Otherwise console.error.
// Measured in the Milestone 3 spike (pino 10, winston 3.19, bunyan 1.8):
// - pino keeps message, stack, code and cause only under the key `err`: { err: error }.
// - winston loses message and stack when the error is inside the metadata object; it keeps them when
//   the error is its own argument after the message. The cause's message is lost either way.
// - bunyan keeps them when the error comes first: log.error(err, "message"). The cause is lost.

import path from "node:path";
import ts from "typescript";
import type { Confidence, LoggerKind } from "../types.js";

/** How the fix's log call is written. E = the error, M = the message (with method and route), C = context. */
export type CallForm =
  | "console" //        console.error("Request failed:", { method, route }, E)
  | "object-first" //   L.error({ <key>: E, method, route }, "Request failed")        (pino)
  | "message-first" //  L.error(`Request failed: ${method} ${route}`, E)              (winston)
  | "message-object" // L.error("Request failed", { <key>: E, method, route })        (copied project form)
  | "error-first" //    L.error(E, `Request failed: ${method} ${route}`)              (bunyan)
  | "error-only"; //    L.error(E)                                                    (copied project form)

export interface LoggerChoice {
  kind: LoggerKind;
  /** The variable the fix calls .error on, e.g. "logger"; "console" for console.error. */
  name: string;
  form: CallForm;
  /** The key the error goes under, for the object forms ("err" for pino). */
  errorKey?: string;
  confidence: Confidence;
  evidence: string;
  /** Notes to show with every fix that uses this logger. */
  notes: string[];
}

/** Reads another file's text (read-only), or undefined if it does not exist. */
export type ReadFile = (absolutePath: string) => string | undefined;

const LIBRARIES = ["pino", "winston", "bunyan"] as const;
type Library = (typeof LIBRARIES)[number];

/** Imported names that look like a logger, for row 3. */
const LOGGER_LIKE = /^(logger|log|[a-z][A-Za-z0-9]*Logger)$/;

const NOTE_WINSTON =
  "With this form winston keeps the error's message, stack trace and code, but not the message of its cause " +
  "(error.cause). A custom format that prints only the message drops the stack: check your logger's format.";
const NOTE_BUNYAN = "With this form bunyan keeps the error's message, stack trace and code, but not its cause (error.cause).";

const CONSOLE: LoggerChoice = {
  kind: "console",
  name: "console",
  form: "console",
  confidence: "low",
  evidence: "no logger was found in this file, so the fix uses console.error, which every Node.js program has",
  notes: [],
};

/** The logger a fix in `sourceFile` should use. `readFile` is used only for one relative import. */
export function chooseLogger(sourceFile: ts.SourceFile, readFile?: ReadFile): LoggerChoice {
  // 1. A logger created in this file. A child logger (root.child({ module: "orders" })) is preferred
  //    over its parent, because it adds its own context to every line.
  const created = createdLoggers(sourceFile);
  const chosen = created.loggers.find(([name]) => created.children.has(name)) ?? created.loggers[0];
  if (chosen !== undefined) {
    const [name, library] = chosen;
    return libraryChoice(library, name, library === "pino" ? "high" : "medium", `this file creates \`${name}\` with ${library}`);
  }

  // 2. A logger imported from a relative module that creates it (one step deep).
  const imports = importedBindings(sourceFile);
  const unresolved: string[] = [];
  for (const binding of imports) {
    if (!binding.specifier.startsWith(".") || readFile === undefined) continue;
    const library = exportedLogger(sourceFile.fileName, binding, readFile);
    if (library !== undefined) {
      return libraryChoice(library, binding.local, "medium", `\`${binding.local}\` comes from "${binding.specifier}", which creates it with ${library}`);
    }
  }

  // 3. A logger-like import that the file already calls with a caught error.
  for (const binding of imports.filter((b) => LOGGER_LIKE.test(b.local))) {
    const example = existingErrorCall(sourceFile, binding.local);
    if (example !== undefined) {
      const line = sourceFile.getLineAndCharacterOfPosition(example.call.getStart(sourceFile)).line + 1;
      return {
        kind: "project",
        name: binding.local,
        form: example.form,
        errorKey: example.errorKey,
        confidence: "medium",
        evidence: `this file already logs a caught error with ${binding.local}.error(...) on line ${line}; the fix copies that call's form`,
        notes: ["LogPilot cannot see how this logger writes errors. Check that it keeps the error's stack trace."],
      };
    }
    unresolved.push(`\`${binding.local}\` from "${binding.specifier}"`);
  }

  // 4. console.error.
  if (unresolved.length > 0) {
    return {
      ...CONSOLE,
      evidence: `this file imports ${unresolved[0]}, but LogPilot could not tell how to call it, so the fix uses console.error`,
    };
  }
  return CONSOLE;
}

function libraryChoice(library: Library, name: string, confidence: Confidence, evidence: string): LoggerChoice {
  if (library === "pino") return { kind: "pino", name, form: "object-first", errorKey: "err", confidence, evidence, notes: [] };
  if (library === "winston") return { kind: "winston", name, form: "message-first", confidence: "medium", evidence, notes: [NOTE_WINSTON] };
  return { kind: "bunyan", name, form: "error-first", confidence: "medium", evidence, notes: [NOTE_BUNYAN] };
}

/** A name imported from a module: `import x from "m"`, `import { a as x } from "m"`, `const x = require("m")`, ... */
interface ImportedBinding {
  local: string;
  /** "default" for a default import or a whole `require(...)`, else the exported name. */
  imported: string;
  specifier: string;
}

function importedBindings(sourceFile: ts.SourceFile): ImportedBinding[] {
  const bindings: ImportedBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
      const specifier = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) bindings.push({ local: clause.name.text, imported: "default", specifier });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          if (!element.isTypeOnly) bindings.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text, specifier });
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const specifier = declaration.initializer === undefined ? undefined : requireSpecifier(declaration.initializer);
        if (specifier === undefined) continue;
        if (ts.isIdentifier(declaration.name)) bindings.push({ local: declaration.name.text, imported: "default", specifier });
        if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            const key = element.propertyName ?? element.name;
            if (ts.isIdentifier(element.name) && ts.isIdentifier(key)) bindings.push({ local: element.name.text, imported: key.text, specifier });
          }
        }
      }
    }
  }
  return bindings;
}

/** "m" for require("m"), also require("m").default; else undefined. */
function requireSpecifier(expression: ts.Expression): string | undefined {
  while (ts.isPropertyAccessExpression(expression)) expression = expression.expression;
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "require" &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0])
  ) {
    return expression.arguments[0].text;
  }
  return undefined;
}

/** Loggers created at the top level of a file, by variable name; which are children; what the file exports. */
function createdLoggers(sourceFile: ts.SourceFile): { loggers: [string, Library][]; children: Set<string>; exports: Map<string, Library> } {
  // Names bound to each library: import pino from "pino", const winston = require("winston"), import { createLogger } ...
  const libraryNames = new Map<string, Library>();
  const factories = new Map<string, Library>(); // createLogger imported by name
  for (const binding of importedBindings(sourceFile)) {
    const library = LIBRARIES.find((l) => l === binding.specifier);
    if (library === undefined) continue;
    if (binding.imported === "default" || binding.imported === library) libraryNames.set(binding.local, library);
    else if (binding.imported === "createLogger") factories.set(binding.local, library);
  }
  for (const statement of sourceFile.statements) {
    // import * as winston from "winston"
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const library = LIBRARIES.find((l) => l === (statement.moduleSpecifier as ts.StringLiteral).text);
      const named = statement.importClause?.namedBindings;
      if (library !== undefined && named !== undefined && ts.isNamespaceImport(named)) libraryNames.set(named.name.text, library);
    }
  }

  const loggers = new Map<string, Library>();
  const children = new Set<string>();
  /** The library of a logger-creating expression: pino(), require("pino")(), winston.createLogger(), x.child(). */
  const libraryOf = (expression: ts.Expression): Library | undefined => {
    if (!ts.isCallExpression(expression)) return ts.isIdentifier(expression) ? loggers.get(expression.text) : undefined;
    const callee = expression.expression;
    if (ts.isIdentifier(callee)) {
      if (libraryNames.get(callee.text) === "pino") return "pino";
      return factories.get(callee.text);
    }
    const required = requireSpecifier(callee);
    if (required === "pino") return "pino";
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const object = callee.expression.text;
      if (callee.name.text === "createLogger") {
        const library = libraryNames.get(object);
        if (library === "winston" || library === "bunyan") return library;
      }
      if (callee.name.text === "child") return loggers.get(object);
    }
    return undefined;
  };

  const exports = new Map<string, Library>();
  for (const statement of sourceFile.statements) {
    const exported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const library = libraryOf(declaration.initializer);
        if (library === undefined) continue;
        loggers.set(declaration.name.text, library);
        const init = declaration.initializer;
        if (ts.isCallExpression(init) && ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === "child") {
          children.add(declaration.name.text);
        }
        if (exported) exports.set(declaration.name.text, library); // export const logger = pino()
      }
    }
    if (ts.isExportAssignment(statement)) {
      const library = libraryOf(statement.expression); // export default pino() / export default logger
      if (library !== undefined) exports.set("default", library);
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const library = loggers.get((element.propertyName ?? element.name).text); // export { logger as log }
        if (library !== undefined) exports.set(element.name.text, library);
      }
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
      const { left, right, operatorToken } = statement.expression;
      if (operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
      const target = left.getText(sourceFile);
      if (target === "module.exports") {
        const library = libraryOf(right); // module.exports = pino() / module.exports = logger
        if (library !== undefined) exports.set("default", library);
        if (ts.isObjectLiteralExpression(right)) {
          // module.exports = { logger } / { log: logger }
          for (const property of right.properties) {
            const value = ts.isShorthandPropertyAssignment(property) ? property.name : ts.isPropertyAssignment(property) ? property.initializer : undefined;
            const library2 = value === undefined ? undefined : libraryOf(value);
            if (library2 !== undefined && property.name !== undefined && ts.isIdentifier(property.name)) exports.set(property.name.text, library2);
          }
        }
      }
      const named = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(target); // exports.logger = logger
      if (named !== null) {
        const library = libraryOf(right);
        if (library !== undefined) exports.set(named[1], library);
      }
    }
  }
  return { loggers: [...loggers], children, exports };
}

/** The library of the logger that `binding` imports from its relative module, read one step deep. */
function exportedLogger(fromFile: string, binding: ImportedBinding, readFile: ReadFile): Library | undefined {
  for (const candidate of moduleCandidates(fromFile, binding.specifier)) {
    const text = readFile(candidate);
    if (text === undefined) continue;
    const module = ts.createSourceFile(candidate, text, ts.ScriptTarget.Latest, true);
    return createdLoggers(module).exports.get(binding.imported);
  }
  return undefined;
}

/** The files a relative import can mean: ./logger -> logger.ts, logger.js, ..., logger/index.ts, ... */
export function moduleCandidates(fromFile: string, specifier: string): string[] {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const extensions = [".ts", ".js", ".mts", ".mjs", ".cts", ".cjs", ".tsx", ".jsx"];
  const candidates: string[] = [];
  if (path.extname(base) !== "") {
    candidates.push(base);
    // TypeScript ESM imports name the compiled file: "./logger.js" means logger.ts.
    const typescript: Record<string, string> = { ".js": ".ts", ".mjs": ".mts", ".cjs": ".cts", ".jsx": ".tsx" };
    const swapped = typescript[path.extname(base)];
    if (swapped !== undefined) candidates.push(base.slice(0, -path.extname(base).length) + swapped);
  }
  for (const extension of extensions) candidates.push(base + extension);
  for (const extension of extensions) candidates.push(path.join(base, `index${extension}`));
  return candidates;
}

/**
 * The first call `<name>.error(...)` in the file that logs a caught error (a catch variable, or the
 * first parameter of error middleware), and the form it is written in.
 */
function existingErrorCall(sourceFile: ts.SourceFile, name: string): { call: ts.CallExpression; form: CallForm; errorKey?: string } | undefined {
  let found: { call: ts.CallExpression; form: CallForm; errorKey?: string } | undefined;
  const caughtNames = (node: ts.Node): Set<string> => {
    const names = new Set<string>();
    for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) {
      if (ts.isCatchClause(current) && current.variableDeclaration && ts.isIdentifier(current.variableDeclaration.name)) {
        names.add(current.variableDeclaration.name.text);
      }
      if (ts.isFunctionLike(current) && current.parameters.length === 4 && ts.isIdentifier(current.parameters[0].name)) {
        names.add(current.parameters[0].name.text);
      }
    }
    return names;
  };
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === name &&
      node.expression.name.text === "error"
    ) {
      const caught = caughtNames(node);
      const isError = (e: ts.Expression) => ts.isIdentifier(e) && caught.has(e.text);
      const keyOf = (e: ts.Expression): string | undefined => {
        if (!ts.isObjectLiteralExpression(e)) return undefined;
        for (const property of e.properties) {
          if (ts.isShorthandPropertyAssignment(property) && caught.has(property.name.text)) return property.name.text;
          if (ts.isPropertyAssignment(property) && isError(property.initializer) && ts.isIdentifier(property.name)) return property.name.text;
        }
        return undefined;
      };
      const [first, second] = node.arguments;
      if (first !== undefined) {
        if (isError(first)) found = { call: node, form: second === undefined ? "error-only" : "error-first" };
        else if (keyOf(first) !== undefined) found = { call: node, form: "object-first", errorKey: keyOf(first) };
        else if (second !== undefined && isError(second)) found = { call: node, form: "message-first" };
        else if (second !== undefined && keyOf(second) !== undefined) found = { call: node, form: "message-object", errorKey: keyOf(second) };
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
