// Fix-preview fixture (v0.4.1): try blocks that save a password-like field get a note on their fix,
// and try blocks that only read one, or put one in the response, do not. See test/lp003-fix.test.ts.
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Account = require("./models/Account");

const router = express.Router();

// 1. NOTE: a password-like key in an object passed to create().
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const user = await User.create({ name, email, password });
    res.status(201).json({ id: user._id });
  } catch (err) {
    res.status(500).json({ message: "Sign-up failed" });
  }
});

// 2. NOTE: user.password = ... and the same user is saved.
router.post("/reset", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    user.password = req.body.newPassword;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Reset failed" });
  }
});

// 3. NOTE: a key nested in an update ($set), and a constructor argument.
router.post("/keys", async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { $set: { apiKey: req.body.key } });
    await new Account({ owner: req.params.id, refreshToken: req.body.token }).save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Saving keys failed" });
  }
});

// 4. No note: login only READS the password, and the token goes into the response.
router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    const ok = await bcrypt.compare(req.body.password, user.password);
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ ok, token });
  } catch (err) {
    res.status(500).json({ message: "Login failed" });
  }
});

// 5. No note: a password-like field set on the response object, which is never saved.
router.post("/invite", async (req, res) => {
  try {
    const user = await User.create({ name: req.body.name, email: req.body.email });
    const data = user.toObject();
    data.generatedPassword = Math.random().toString(36);
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ message: "Invite failed" });
  }
});

// 6. NOTE (case C): the error is added to the existing console call, and the try saves a password.
router.post("/staff", async (req, res) => {
  try {
    await User.create({ email: req.body.email, password: req.body.password });
    res.sendStatus(201);
  } catch (err) {
    console.log("could not create staff");
    res.status(500).json({ message: "Failed" });
  }
});

// 7. Edge, NOTE (documented noise): the field names match, but hold a date, a postal PIN code and a flag.
router.post("/profile", async (req, res) => {
  try {
    await User.updateOne({ _id: req.params.id }, { passwordChangedAt: new Date(), pinCode: req.body.pinCode, passThrough: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});

// 8. Edge, no note: these names only contain a secret word inside a longer word.
router.post("/club", async (req, res) => {
  try {
    await User.create({ secretary: req.body.name, spinner: true, isPinned: false, bypass: false });
    res.sendStatus(201);
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

module.exports = router;
