// Fix-preview fixture: the logger comes from a relative module (./lib/logger), which creates it
// with pino. LogPilot reads that one module (and no further) to know how to call it.
const express = require("express");
const logger = require("./lib/logger");

const router = express.Router();

router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

module.exports = router;
