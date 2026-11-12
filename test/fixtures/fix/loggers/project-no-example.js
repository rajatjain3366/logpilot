// Fix-preview fixture: a logger LogPilot cannot identify, and no example of how the file logs an
// error with it. The fix uses console.error and says why.
const express = require("express");
const logger = require("./lib/custom-logger");

const router = express.Router();

router.get("/orders/:id", async (req, res) => {
  logger.error("loading order");
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

module.exports = router;
