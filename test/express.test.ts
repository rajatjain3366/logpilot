// Tests for src/rules/express.ts: recognising Express request handlers and error middleware.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { findExpressHandlers } from "../src/rules/express.js";

/** [line, kind, how, res, error] for every handler found in `code`. */
function handlers(code: string, fileName = "routes.js") {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  return findExpressHandlers(sourceFile).map((h) => [
    sourceFile.getLineAndCharacterOfPosition(h.node.getStart(sourceFile)).line + 1,
    h.kind,
    h.how,
    h.res,
    h.error ?? null,
  ]);
}

describe("Express handlers registered in the same file (confidence comes from this)", () => {
  it("recognises app.METHOD handlers, with express imported as ESM or with require()", () => {
    const esm = [
      'import express from "express";',
      "const app = express();",
      'app.get("/users", async (req, res) => { res.json([]); });',
      'app.post("/users", function (request, response, next) { next(); });',
    ];
    const cjs = ['const express = require("express");', "const app = express();", 'app.delete("/x", (req, res) => {});'];

    expect(handlers(esm.join("\n"))).toEqual([
      [3, "request", "registered", "res", null],
      [4, "request", "registered", "response", null],
    ]);
    expect(handlers(cjs.join("\n"))).toEqual([[3, "request", "registered", "res", null]]);
  });

  it("recognises routers (express.Router(), Router() imported from express), app.use and app.route() chains", () => {
    const code = [
      'const express = require("express");',
      'const { Router } = require("express");',
      "const router = express.Router();",
      "const admin = Router();",
      "const app = express();",
      'router.put("/a", (req, res) => {});',
      "admin.use((req, res, next) => next());",
      'app.route("/b")',
      "  .get((req, res) => {})",
      "  .patch((req, res) => {});",
    ];

    expect(handlers(code.join("\n"))).toEqual([
      [6, "request", "registered", "res", null],
      [7, "request", "registered", "res", null],
      [9, "request", "registered", "res", null],
      [10, "request", "registered", "res", null],
    ]);
  });

  it("unwraps one wrapper call and arrays, and finds same-file functions passed by name", () => {
    const code = [
      'import express from "express";',
      "const router = express.Router();",
      "function auth(req, res, next) { next(); }",
      "const list = async (req, res) => {};",
      "const create = asyncHandler(async (req, res) => {});",
      'router.get("/", auth, list);',
      'router.post("/", [auth], create);',
      'router.patch("/:id", catchAsync(async (req, res) => {}));',
    ];

    expect(handlers(code.join("\n"))).toEqual([
      [3, "request", "registered", "res", null],
      [4, "request", "registered", "res", null],
      [5, "request", "registered", "res", null],
      [8, "request", "registered", "res", null],
    ]);
  });

  it("recognises four-parameter error middleware passed to app.use", () => {
    const code = [
      'import express from "express";',
      "const app = express();",
      "app.use((err, req, res, next) => { res.status(500).end(); });",
    ];

    expect(handlers(code.join("\n"))).toEqual([[3, "error-middleware", "registered", "res", "err"]]);
  });
});

describe("Express handlers recognised by shape only (e.g. controllers in another file)", () => {
  it("recognises (req, res) functions that call a response method on res or response", () => {
    const code = [
      "exports.getUsers = async (req, res) => { res.json([]); };",
      "export const createUser = async (req, response) => { response.status(201).json({}); };",
      "class UserController {",
      "  async remove(req, res, next) { res.sendStatus(204); }",
      "}",
      "module.exports.onError = (err, req, res, next) => { res.status(500).send('x'); };",
    ];

    expect(handlers(code.join("\n"), "controllers/users.js")).toEqual([
      [1, "request", "shape", "res", null],
      [2, "request", "shape", "response", null],
      [4, "request", "shape", "res", null],
      [6, "error-middleware", "shape", "res", "err"],
    ]);
  });

  it("lists a function once, as registered, when it also has the shape", () => {
    const code = ['import express from "express";', "const app = express();", 'app.get("/", (req, res) => { res.json(1); });'];

    expect(handlers(code.join("\n"))).toEqual([[3, "request", "registered", "res", null]]);
  });

  it("uses the shape for dynamically registered routes", () => {
    const code = ['import express from "express";', "const app = express();", 'app[method]("/x", (req, res) => { res.json(1); });'];

    expect(handlers(code.join("\n"))).toEqual([[3, "request", "shape", "res", null]]);
  });
});

describe("Functions that are not Express handlers", () => {
  it("ignores callbacks of objects that are not an Express app or router", () => {
    const code = ['import express from "express";', 'cache.get("key", (req, res) => {});', 'emitter.use((a, b) => {});'];

    expect(handlers(code.join("\n"))).toEqual([]);
  });

  it("ignores app.get(setting), (req, res) functions that never respond, and other frameworks", () => {
    const code = [
      'import express from "express";',
      "const app = express();",
      'const proxy = app.get("trust proxy");',
      "function format(req, res) { return req.url + res.statusCode; }",
      'koaRouter.get("/", async (ctx) => { ctx.body = "hi"; });', //          Koa: one ctx parameter
      "fastify.get('/', async (request, reply) => { reply.code(500).send(); });", // Fastify: reply, not res
      "const h = (req, { json }) => json({});", //                             destructured response
    ];

    expect(handlers(code.join("\n"))).toEqual([]);
  });

  it("does not register handlers of an app that is not created from express in this file", () => {
    const code = ['app.get("/", (req, res) => {});', 'router.post("/", (req, res) => {});'];

    expect(handlers(code.join("\n"))).toEqual([]); // no response call either, so not even the shape
  });
});
