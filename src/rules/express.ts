// Express handler recognition: which functions in a file handle Express requests.
// Used by LP003. It only reads the syntax tree of one file; it never follows imports.
//
// Two ways to recognise a handler:
// - "registered": the function is passed to app/router .get/.post/.put/.patch/.delete/.all/
//   .options/.head/.use(...) or an app.route(path).get(...) chain, where the app or router was
//   created from express in this file. Inline functions, one wrapper call such as
//   asyncHandler(fn), arrays of handlers, and same-file functions passed by name are followed.
// - "shape": any other function whose response parameter is called `res` or `response` and that
//   calls an Express response method on it (res.status, res.json, ...). This is how controllers
//   in other files are recognised, so it is less certain (LP003 gives these confidence medium).

import ts from "typescript";

/** A function that Express calls for a request: a route handler/middleware, or error middleware. */
export interface ExpressHandler {
  node: ts.SignatureDeclaration;
  /** "error-middleware" = the four-parameter (err, req, res, next) form. */
  kind: "request" | "error-middleware";
  /** "registered" = passed to app/router.get/post/use/... in this file; "shape" = recognised by its parameters only. */
  how: "registered" | "shape";
  /** Name of the response parameter, e.g. "res". */
  res: string;
  /** Error middleware only: name of the error parameter, e.g. "err". */
  error?: string;
}

/** Methods of an Express app or router that register handlers. */
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "options", "head", "use"]);

/** Express response methods that set the status or send a response. */
export const RESPONSE_METHODS = new Set(["status", "sendStatus", "json", "send", "end", "render", "redirect"]);

/** Parameter names that the shape check accepts for the response object. */
const RESPONSE_NAMES = new Set(["res", "response"]);

type FunctionNode = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | ts.MethodDeclaration;

/** Every Express handler in the file, in source order. */
export function findExpressHandlers(sourceFile: ts.SourceFile): ExpressHandler[] {
  const { express, routerFactories } = expressImports(sourceFile);
  const apps = appVariables(sourceFile, express, routerFactories);
  const declarations = namedFunctions(sourceFile);

  // 1. Registered handlers.
  const registered = new Set<FunctionNode>();
  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      if (ROUTE_METHODS.has(callee.name.text) && isAppChain(callee.expression, apps)) {
        for (const argument of node.arguments) {
          for (const fn of handlerFunctions(argument, declarations, true)) registered.add(fn);
        }
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sourceFile);

  // 2. Every function, in source order: registered ones, then the rest by shape.
  const handlers: ExpressHandler[] = [];
  const visitFunctions = (node: ts.Node): void => {
    if (isFunctionNode(node)) {
      const handler = registered.has(node) ? fromParameters(node, "registered") : byShape(node);
      if (handler !== undefined) handlers.push(handler);
    }
    ts.forEachChild(node, visitFunctions);
  };
  visitFunctions(sourceFile);
  return handlers;
}

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node);
}

/** Names bound to the express module (`express`) and to its Router factory (`Router`). */
function expressImports(sourceFile: ts.SourceFile): { express: Set<string>; routerFactories: Set<string> } {
  const express = new Set<string>();
  const routerFactories = new Set<string>();
  const visit = (node: ts.Node): void => {
    // import express from "express"; import * as express from "express"; import { Router } from "express"
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "express") {
      const clause = node.importClause;
      if (clause?.name) express.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) express.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if ((element.propertyName ?? element.name).text === "Router") routerFactories.add(element.name.text);
        }
      }
    }
    // const express = require("express"); const { Router } = require("express")
    if (ts.isVariableDeclaration(node) && node.initializer && isRequireExpress(node.initializer)) {
      if (ts.isIdentifier(node.name)) express.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (ts.isIdentifier(key) && key.text === "Router" && ts.isIdentifier(element.name)) routerFactories.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { express, routerFactories };
}

function isRequireExpress(expression: ts.Expression): boolean {
  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "require" &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0]) &&
    expression.arguments[0].text === "express"
  );
}

/** Variables holding an app or router: express(), express.Router(), Router(), require("express")(). */
function appVariables(sourceFile: ts.SourceFile, express: Set<string>, routerFactories: Set<string>): Set<string> {
  const apps = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const callee = node.initializer.expression;
      const createsApp =
        (ts.isIdentifier(callee) && (express.has(callee.text) || routerFactories.has(callee.text))) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "Router" && ts.isIdentifier(callee.expression) && express.has(callee.expression.text)) ||
        isRequireExpress(callee);
      if (createsApp) apps.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return apps;
}

/** `app`, or a chain built on it such as `app.route("/x").get(...)`. */
function isAppChain(expression: ts.Expression, apps: Set<string>): boolean {
  if (ts.isIdentifier(expression)) return apps.has(expression.text);
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text;
    return (method === "route" || ROUTE_METHODS.has(method)) && isAppChain(expression.expression.expression, apps);
  }
  return false;
}

/** Functions defined in this file, by name: `function name(...)` and `const name = (...) => ...`. */
export function sameFileFunctions(sourceFile: ts.SourceFile): Map<string, ts.FunctionLikeDeclaration> {
  const functions = new Map<string, ts.FunctionLikeDeclaration>();
  for (const [name, node] of namedFunctions(sourceFile)) {
    let candidate = node;
    while (ts.isParenthesizedExpression(candidate)) candidate = candidate.expression;
    if (isFunctionNode(candidate)) functions.set(name, candidate);
  }
  return functions;
}

/** Function declarations and `const name = <function or wrapper call>` in the file, by name. */
function namedFunctions(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const names = new Map<string, ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && !names.has(node.name.text)) names.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !names.has(node.name.text)) {
      names.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * The handler functions that an argument of app.get(...) stands for: an inline function, the
 * elements of an array, the function inside ONE wrapper call such as asyncHandler(fn), or a
 * function defined in this file and passed by name.
 */
function handlerFunctions(argument: ts.Node, declarations: Map<string, ts.Node>, mayUnwrap: boolean): FunctionNode[] {
  while (ts.isParenthesizedExpression(argument)) argument = argument.expression;
  if (isFunctionNode(argument)) return [argument];
  if (ts.isArrayLiteralExpression(argument)) {
    return argument.elements.flatMap((element) => handlerFunctions(element, declarations, mayUnwrap));
  }
  if (ts.isCallExpression(argument) && mayUnwrap) {
    return argument.arguments.flatMap((inner) => handlerFunctions(inner, declarations, false));
  }
  if (ts.isIdentifier(argument)) {
    const declaration = declarations.get(argument.text);
    if (declaration !== undefined && declaration !== argument) return handlerFunctions(declaration, new Map(), mayUnwrap);
  }
  return [];
}

/** The handler that a registered function is, from its parameters: (req, res[, next]) or (err, req, res, next). */
function fromParameters(fn: FunctionNode, how: ExpressHandler["how"]): ExpressHandler | undefined {
  const names = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : undefined));
  if (names.length === 4 && names[0] !== undefined && names[2] !== undefined) {
    return { node: fn, kind: "error-middleware", how, res: names[2], error: names[0] };
  }
  if ((names.length === 2 || names.length === 3) && names[1] !== undefined) {
    return { node: fn, kind: "request", how, res: names[1] };
  }
  return undefined;
}

/** A function that looks like an Express handler: `res`/`response` parameter used for a response. */
function byShape(fn: FunctionNode): ExpressHandler | undefined {
  const handler = fromParameters(fn, "shape");
  if (handler === undefined || !RESPONSE_NAMES.has(handler.res) || fn.body === undefined) return undefined;
  return containsResponseCall(fn.body, handler.res) ? handler : undefined;
}

function containsResponseCall(node: ts.Node, res: string): boolean {
  if (ts.isCallExpression(node) && isResponseCall(node, res)) return true;
  return ts.forEachChild(node, (child) => containsResponseCall(child, res)) ?? false;
}

/** True for res.json(...), res.status(500).json(...), res.sendStatus(500), ... on the response `res`. */
export function isResponseCall(call: ts.CallExpression, res: string): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || !RESPONSE_METHODS.has(callee.name.text)) return false;
  let object: ts.Expression = callee.expression;
  // Walk down a chain such as res.status(500).json: the call res.status(500), then res.
  while (ts.isCallExpression(object) && ts.isPropertyAccessExpression(object.expression)) {
    object = object.expression.expression;
  }
  return ts.isIdentifier(object) && object.text === res;
}
