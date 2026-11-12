// Fix-preview fixture (v0.4.1): the body is saved with a model from ../models/User.js. When only this
// routes/ folder is scanned, that model is outside the scanned folder and is not read: no note.
// When the parent folder is scanned, it is read and the fix gets the note. See test/lp003-fix.test.ts.
const express = require("express");
const User = require("../models/User");

const router = express.Router();

router.post("/admins", async (req, res) => {
  try {
    res.status(201).json(await User.create(req.body));
  } catch (err) {
    res.status(500).json({ message: "Could not create the admin" });
  }
});

module.exports = router;
