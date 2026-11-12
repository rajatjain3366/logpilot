// Secret fields in a fix's try block (v0.4.1): does the code in the try save a password-like field?
// If it does, an LP003 fix that logs the whole error gets a note, because a validation error can
// keep the failing value (measured with Mongoose 9: `errors.password.value`, printed by
// console.error and pino). It is a note, never a refusal: the value is only in the error when that
// field itself fails validation, which many handlers rule out by checking it first.
//
// What counts as "saving" a field (code in the try block, outside nested functions):
//   a. an object passed to `new X(...)` or to a write call (create, insert..., save, update...,
//      findOneAndUpdate, findByIdAndUpdate, replaceOne, upsert, build, bulkCreate, set) that has a
//      password-like key, at any depth: User.create({ password }), update(id, { $set: { apiKey } });
//   b. `x.password = ...`, when the same `x` is saved in the try block (`x.save()`);
//   c. the whole request body (`req.body`, `{ ...req.body }`) passed to such a call, when the
//      model's schema, read one step like logger detection, has a password-like field.
// Reading never goes further than one relative import inside the scanned folder; a model from a
// package or from outside the scanned folder is not checked.

import ts from "typescript";
import { nameWords } from "../names.js";
import { importedBindings, moduleCandidates, type ReadFile } from "./loggers.js";

/** Words that make a name password-like. */
const SECRET_WORDS = new Set(["password", "passwd", "pwd", "passphrase", "pass", "secret", "token", "otp", "pin", "cvv", "cvc"]);
/** Two words in a row that make a name password-like. */
const SECRET_PAIRS = new Set(["api key", "private key", "access key", "secret key", "card number"]);

/** Methods that write data (and so validate it) in Mongoose, Sequelize, Prisma, knex and TypeORM. */
const WRITE_METHODS = new Set([
  "create", "insert", "insertOne", "insertMany", "save", "update", "updateOne", "updateMany",
  "findOneAndUpdate", "findByIdAndUpdate", "replaceOne", "upsert", "build", "bulkCreate", "set",
]);

/**
 * True for names like password, newPassword, password_confirmation, apiKey, x-api-key, refreshToken,
 * pin, cardNumber. Whole words only: secretary, spinner, isPinned and bypass do not match.
 */
export function isPasswordLike(name: string): boolean {
  const words = nameWords(name);
  return words.some((word, i) => SECRET_WORDS.has(word) || (i > 0 && SECRET_PAIRS.has(`${words[i - 1]} ${word}`)));
}

/** What a try block saves that is password-like, and where. */
export interface SecretWrite {
  /** The password-like field names, in the order found. */
  fields: string[];
  /** 1-based line of the first write that saves one. */
  line: number;
  /** Set when the fields come from the model's schema (the whole request body is saved). */
  model?: { name: string; specifier: string };
}

/**
 * The password-like fields that `tryBlock` saves, or undefined. `requestName` is the handler's
 * request parameter, `res` its response parameter (writes on it are responses, not saves).
 */
export function secretWrites(
  tryBlock: ts.Block,
  requestName: string | undefined,
  res: string,
  sourceFile: ts.SourceFile,
  readFile?: ReadFile,
): SecretWrite | undefined {
  const direct: { field: string; node: ts.Node }[] = [];
  const assigned: { object: string; field: string; node: ts.Node }[] = [];
  const saved = new Set<string>();
  const bodyWrites: { model: string; node: ts.Node }[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return; // code in nested functions runs at another time
    // b. x.password = ... (counted below, only when x is also saved)
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      isPasswordLike(node.left.name.text)
    ) {
      assigned.push({ object: node.left.expression.text, field: node.left.name.text, node });
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
      if (node.expression.name.text === "save" || node.expression.name.text === "validate") saved.add(node.expression.expression.text);
    }
    // a. and c.: the arguments of new X(...) and of write calls (not on the response)
    const isWrite =
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_METHODS.has(node.expression.name.text) &&
      !(ts.isIdentifier(node.expression.expression) && node.expression.expression.text === res);
    if ((ts.isNewExpression(node) || isWrite) && node.arguments !== undefined) {
      for (const argument of node.arguments) {
        for (const field of passwordLikeKeys(argument)) direct.push({ field, node });
        if (requestName !== undefined && isWholeBody(argument, requestName)) {
          const model = rootName(node.expression);
          if (model !== undefined) bodyWrites.push({ model, node });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(tryBlock, visit);

  const found = [...direct, ...assigned.filter((a) => saved.has(a.object))];
  if (found.length > 0) {
    found.sort((x, y) => x.node.getStart(sourceFile) - y.node.getStart(sourceFile));
    return { fields: unique(found.map((f) => f.field)), line: lineOf(found[0].node, sourceFile) };
  }

  // c. The whole request body: only when the model's schema shows a password-like field.
  for (const write of bodyWrites) {
    const binding = importedBindings(sourceFile).find((b) => b.local === write.model);
    if (binding === undefined || !binding.specifier.startsWith(".") || readFile === undefined) continue;
    const fields = schemaSecretFields(sourceFile.fileName, binding.specifier, readFile);
    if (fields.length > 0) {
      return { fields, line: lineOf(write.node, sourceFile), model: { name: write.model, specifier: binding.specifier } };
    }
  }
  return undefined;
}

/** Password-like keys of every object literal inside `node`. */
function passwordLikeKeys(node: ts.Node): string[] {
  const keys: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isObjectLiteralExpression(child)) {
      for (const property of child.properties) {
        const name = propertyName(property);
        if (name !== undefined && isPasswordLike(name)) keys.push(name);
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return keys;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return property.name.text;
  return undefined;
}

/** `req.body`, or an object that spreads it: `{ ...req.body }`, `{ ...req.body, owner: id }`. */
function isWholeBody(expression: ts.Expression, requestName: string): boolean {
  const isBody = (e: ts.Expression) =>
    ts.isPropertyAccessExpression(e) && e.name.text === "body" && ts.isIdentifier(e.expression) && e.expression.text === requestName;
  if (isBody(expression)) return true;
  return ts.isObjectLiteralExpression(expression) && expression.properties.some((p) => ts.isSpreadAssignment(p) && isBody(p.expression));
}

/** `User` for `User.create`, `new User`, `db.User.create`'s first name: the name the model comes from. */
function rootName(expression: ts.Expression): string | undefined {
  let current = expression;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

/**
 * Password-like fields declared in the schema of the module `specifier` (read one step):
 * `new Schema({...})`, `new mongoose.Schema({...})`, `Model.init({...})`, `sequelize.define(name, {...})`.
 */
function schemaSecretFields(fromFile: string, specifier: string, readFile: ReadFile): string[] {
  for (const candidate of moduleCandidates(fromFile, specifier)) {
    const text = readFile(candidate);
    if (text === undefined) continue;
    const module = ts.createSourceFile(candidate, text, ts.ScriptTarget.Latest, true);
    const fields: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        const schema = name === "Schema" || name === "init" ? node.arguments?.[0] : name === "define" ? node.arguments?.[1] : undefined;
        if (schema !== undefined && ts.isObjectLiteralExpression(schema)) {
          for (const property of schema.properties) {
            const field = propertyName(property);
            if (field !== undefined && isPasswordLike(field)) fields.push(field);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module);
    return unique(fields);
  }
  return [];
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
