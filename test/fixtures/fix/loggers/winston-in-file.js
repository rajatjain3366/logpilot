// Fix-preview fixture: the file creates a winston logger. winston keeps the error's message and
// stack only when the error is its own argument, so the fix writes logger.error(message, err).
const express = require("express");
const winston = require("winston");

const logger = winston.createLogger({ transports: [new winston.transports.Console()] });
const router = express.Router();

router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

module.exports = router;
