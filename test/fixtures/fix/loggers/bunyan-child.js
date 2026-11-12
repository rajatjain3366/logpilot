// Fix-preview fixture: a bunyan logger and a child of it. bunyan keeps the error's stack when the
// error comes first, so the fix writes log.error(err, message) with the child logger.
const express = require("express");
const bunyan = require("bunyan");

const root = bunyan.createLogger({ name: "shop" });
const log = root.child({ module: "orders" });
const router = express.Router();

router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

module.exports = router;
