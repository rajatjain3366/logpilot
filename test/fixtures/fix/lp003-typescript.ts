// Fix-preview fixture for LP003 in TypeScript: a typed `catch (error: unknown)` and typed
// handler parameters. See test/lp003-fix.test.ts.

import { Router, type Request, type Response } from "express";

const router = Router();

router.get("/items", async (req: Request, res: Response) => {
  try {
    res.json(await loadItems());
  } catch (error: unknown) {
    res.status(500).json({ message: "Could not load items" });
  }
});

export default router;
