// Fix-preview fixture for LP003: where the fixer puts the log line, and when it proposes no fix.
// No logger is imported, so every fix uses console.error. See test/lp003-fix.test.ts.

const express = require("express");
const User = require("./models/user");

const router = express.Router();

// 1. A duplicate answers 409; only the 500 response gets the log line (before its comment).
router.post("/users", async (req, res) => {
  try {
    res.status(201).json(await User.create(req.body));
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Email already registered" });
    }
    // Anything else is unexpected.
    res.status(500).json({ message: "Server error" });
  }
});

// 2. catch {} whose block already uses another variable named `err`: the new variable is `error`.
router.get("/users/:id", async (req, res) => {
  const err = "users/not-found";
  try {
    res.json(await User.findById(req.params.id));
  } catch {
    res.status(500).render(err);
  }
});

// 3. catch {} whose block uses both `err` and `error`: the new variable is `caughtError`.
router.get("/report", async (req, res) => {
  const err = "report/error";
  const error = "fallback";
  try {
    res.json(await User.report());
  } catch {
    res.status(500).render(err, { error });
  }
});

// 4. An unbraced if/else: the log line goes to the start of the catch block (and logs the 400 too).
router.put("/users/:id", async (req, res) => {
  try {
    res.json(await User.findByIdAndUpdate(req.params.id, req.body));
  } catch (error) {
    if (error.name === "ValidationError") res.status(400).json({ message: error.message });
    else res.status(500).json({ message: "Update failed" });
  }
});

// 5. A one-line catch: the log line goes on the same line.
router.delete("/users/:id", async (req, res) => {
  try { await User.deleteOne({ _id: req.params.id }); res.sendStatus(204); } catch (err) { res.sendStatus(500); }
});

// 6. The request's headers, query string and URL are used nearby; the fix logs none of them.
router.get("/search", async (req, res) => {
  try {
    const token = req.headers.authorization;
    res.json(await User.search(req.query.q, token, req.originalUrl, req.cookies));
  } catch (err) {
    res.status(500).json({ message: "Search failed", path: req.path });
  }
});

// 7. A 4xx answer only (case E): no fix.
router.post("/login", async (req, res) => {
  try {
    res.json(await User.login(req.body));
  } catch (err) {
    res.status(401).json({ message: "Invalid credentials" });
  }
});

// 8. The error is unpacked, so the whole error is not available: no fix.
router.get("/profile", async (req, res) => {
  try {
    res.json(await User.profile(req.params.id));
  } catch ({ message }) {
    res.status(500).json({ message });
  }
});

// 9. A switch on the error: the log line goes into the default case, before the 500.
router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await User.order(req.params.id));
  } catch (err) {
    switch (err.code) {
      case "NOT_FOUND":
        return res.status(404).end();
      default:
        res.status(500).end();
    }
  }
});

// 10. The response goes through a helper defined in this file.
function sendError(res, status, message) {
  res.status(status).json({ message });
}

router.get("/teams", async (req, res) => {
  try {
    res.json(await User.teams());
  } catch (err) {
    sendError(res, 500, "Could not load teams");
  }
});

const app = express();
app.use("/api", router);

// 11. Error middleware with braces; its request parameter is called `_req`.
app.use((err, _req, res, _next) => {
  res.status(500).json({ message: "Internal error" });
});

// 12. Error middleware without braces: no fix.
app.use((err, req, res, next) => res.status(500).json({ message: "Internal error" }));

module.exports = app;
