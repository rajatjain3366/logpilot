// Fix-preview fixture: a logger LogPilot cannot identify, but the file already logs a caught error
// with it as logger.error(message, err). The fix copies that form.
const express = require("express");
const logger = require("./lib/custom-logger");

const router = express.Router();

router.get("/users", async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    logger.error("Could not list users", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

module.exports = router;
