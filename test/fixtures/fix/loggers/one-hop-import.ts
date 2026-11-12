// Fix-preview fixture: a TypeScript ES module imports a renamed logger from "./lib/app-logger.js",
// which names the compiled file; the source is lib/app-logger.ts.
import { Router } from "express";
import { appLogger as log } from "./lib/app-logger.js";

const router = Router();

router.get("/orders/:id", async (req, res) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ message: "Could not load the order" });
  }
});

export default router;
