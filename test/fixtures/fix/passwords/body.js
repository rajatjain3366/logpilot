// Fix-preview fixture (v0.4.1): saving the whole request body. LogPilot cannot know what a body
// holds, so it notes it only when the model's schema (read one step, inside the scanned folder)
// has a password-like field. See test/lp003-fix.test.ts.
const express = require("express");
const User = require("./models/User");
const Product = require("./models/Product");
const { Order } = require("@acme/models");

const router = express.Router();

// 1. NOTE: the body is spread into a new User, and models/User.js has a password field.
router.post("/users", async (req, res) => {
  try {
    const user = new User({ ...req.body, role: "member" });
    await user.save();
    res.status(201).json({ id: user._id });
  } catch (err) {
    res.status(500).json({ message: "Could not create the user" });
  }
});

// 2. NOTE: the body itself is passed to create().
router.post("/users/bulk", async (req, res) => {
  try {
    res.status(201).json(await User.create(req.body));
  } catch (err) {
    res.status(500).json({ message: "Could not create the user" });
  }
});

// 3. No note: models/Product.js has no password-like field.
router.post("/products", async (req, res) => {
  try {
    res.status(201).json(await Product.create(req.body));
  } catch (err) {
    res.status(500).json({ message: "Could not create the product" });
  }
});

// 4. No note: the model comes from a package, which LogPilot does not read.
router.post("/orders", async (req, res) => {
  try {
    res.status(201).json(await Order.create(req.body));
  } catch (err) {
    res.status(500).json({ message: "Could not create the order" });
  }
});

module.exports = router;
