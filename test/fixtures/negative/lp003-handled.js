// Negative fixture for LP003: Express handlers whose catch keeps the error, code that is not an
// Express request handler, and error middleware that records the error. No rule may report
// anything in this file.

const express = require("express");
const Sentry = require("@sentry/node");
const logger = require("./logger");
const { handleError } = require("./errors");
const User = require("./models/user");

const app = express();

// Logged with console.error, then a generic response.
app.get("/a", async (req, res) => {
  try {
    res.json(await User.find());
  } catch (err) {
    console.error("failed to list users", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Logged with a pino-style logger and pino-http's req.log, and reported to Sentry.
app.get("/b", async (req, res) => {
  try {
    res.json(await User.find());
  } catch (err) {
    logger.error({ err }, "failed to list users");
    req.log.error(err);
    Sentry.captureException(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Passed on to the error middleware.
app.get("/c", async (req, res, next) => {
  try {
    res.json(await User.find());
  } catch (err) {
    next(err);
  }
});

// Passed on, wrapped with the cause kept.
app.get("/d", async (req, res, next) => {
  try {
    res.json(await User.find());
  } catch (err) {
    return next(new Error("Could not list users", { cause: err }));
  }
});

// One expected error is answered; everything else is rethrown (an async wrapper passes it on).
app.get("/e/:id", async (req, res) => {
  try {
    res.json(await User.findById(req.params.id));
  } catch (err) {
    if (err.name === "CastError") return res.status(400).json({ message: "Invalid id" });
    throw err;
  }
});

// Handed to a helper LogPilot cannot see into: assumed to handle it.
app.get("/f", async (req, res) => {
  try {
    res.json(await User.find());
  } catch (err) {
    handleError(res, err);
  }
});

// Stored for a later middleware: LogPilot cannot tell what happens to it.
app.get("/g", async (req, res, next) => {
  try {
    res.json(await User.find());
  } catch (err) {
    res.locals.error = err;
    res.status(500);
    next();
  }
});

// Checks the error type and passes everything else on.
app.post("/h", async (req, res, next) => {
  try {
    res.status(201).json(await User.create(req.body));
  } catch (err) {
    if (err.name === "ValidationError") {
      return res.status(400).json({ message: "Invalid user data" });
    }
    next(err);
  }
});

// No response in the catch: a fallback value (LP003 is about error responses).
app.get("/i", async (req, res) => {
  let users = [];
  try {
    users = await User.find();
  } catch (err) {
    users = [];
  }
  res.json(users);
});

// Not a request handler: a service function without a response.
async function findUser(id) {
  try {
    return await User.findById(id);
  } catch (err) {
    return null;
  }
}

// A catch inside a nested callback of a handler runs at another time: not checked.
app.get("/j", (req, res) => {
  setTimeout(() => {
    try {
      refreshCache();
    } catch (err) {
      res.status(500).end();
    }
  }, 0);
  res.json({ ok: true });
});

// "Not found" answered without a catch.
app.get("/k/:id", async (req, res, next) => {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ message: "Not found" });
  res.json(user);
});

// Error middleware that logs the error before responding.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Server error" });
});

// Error middleware that delegates once the response has started, and logs otherwise.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  logger.error({ err }, "request failed");
  res.status(err.status || 500).json({ message: "Server error" });
});

// A helper in the same file that logs the error before answering: the error is kept.
const fail = (res, error, label) => {
  console.error(`${label} failed:`, error);
  return res.status(500).json({ message: "Internal server error" });
};
app.get("/l", async (req, res) => {
  try {
    res.json(await User.find());
  } catch (error) {
    return fail(res, error, "List users");
  }
});

// Other frameworks are not recognised: Koa (ctx) and Fastify (reply).
koaRouter.get("/koa", async (ctx) => {
  try {
    ctx.body = await User.find();
  } catch (err) {
    ctx.status = 500;
  }
});
fastify.get("/fastify", async (request, reply) => {
  try {
    return await User.find();
  } catch (err) {
    reply.code(500).send({ message: "Server error" });
  }
});

module.exports = app;
