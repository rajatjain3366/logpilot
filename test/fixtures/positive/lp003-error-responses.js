// Positive fixture for LP003 (unlogged-error-response): catch blocks in Express route handlers
// that send an error response, while the caught error is never logged, passed on or rethrown.
// In production only the status code (e.g. "500") is left; the reason is gone.

const express = require("express");
const User = require("./models/user");

const router = express.Router();

// Case A: 5xx response, the error is never used.
router.get("/users/:id", async (req, res) => {
  try {
    res.json(await User.findById(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Case A: res.sendStatus(500), and a catch without an error variable.
router.delete("/users/:id", async (req, res) => {
  try {
    await User.deleteOne({ _id: req.params.id });
    res.sendStatus(204);
  } catch {
    res.sendStatus(500);
  }
});

// Case A: a status LogPilot cannot read; the error only chooses the status code.
router.put("/users/:id", async (req, res) => {
  try {
    res.json(await User.updateOne({ _id: req.params.id }, req.body));
  } catch (error) {
    return res.status(error.status || 500).json({ message: "Update failed" });
  }
});

// Case B: the error is only sent to the client.
router.post("/users", async (req, res) => {
  try {
    res.status(201).json(await User.create(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Case B: the whole error object is sent (it serialises to {}), through a local variable.
router.get("/users", async (req, res) => {
  try {
    res.json(await User.find());
  } catch (err) {
    const details = { error: err };
    res.status(503).json(details);
  }
});

// Case C: a log line, but without the error.
router.get("/stats", async (req, res) => {
  try {
    res.json(await User.countDocuments());
  } catch (err) {
    console.log("error while counting users");
    res.status(500).send("Something went wrong");
  }
});

// Case D: no status is set, so the failure is sent as 200 OK.
router.get("/profile", async (req, res) => {
  try {
    res.json(await User.findById(req.user.id));
  } catch (e) {
    res.json({ success: false, message: "Could not load profile" });
  }
});

// Case D: an error page rendered without a status.
router.get("/page", async (req, res) => {
  try {
    res.render("page", { users: await User.find() });
  } catch (e) {
    res.render("error");
  }
});

module.exports = router;
