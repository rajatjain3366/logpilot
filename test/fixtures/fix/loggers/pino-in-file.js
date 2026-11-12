// Fix-preview fixture: the file creates a pino logger, so the fix uses it, with the error under
// pino's `err` key (the only key pino's error serializer reads). See test/lp003-fix.test.ts.
const express = require("express");
const pino = require("pino");

const logger = pino({ level: "info" });
const router = express.Router();

router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (error) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

module.exports = router;
