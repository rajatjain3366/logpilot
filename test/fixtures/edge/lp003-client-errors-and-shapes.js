// Edge fixture for LP003: findings with a lower severity or confidence.
// - Case E: a 4xx response with the error not logged: "database down" becomes "400 invalid data".
// - Handlers recognised only by their shape (controllers in their own file): confidence medium.

const express = require("express");
const Product = require("./models/product");

const app = express();

// Case E: a 400 response, the error is never used.
app.post("/products", async (req, res) => {
  try {
    res.status(201).json(await Product.create(req.body));
  } catch (err) {
    res.status(400).json({ message: "Invalid product data" });
  }
});

// Case E: a 404 response that also sends the error message.
app.get("/products/:id", async (req, res) => {
  try {
    res.json(await Product.findById(req.params.id));
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
});

// Shape only (an exported controller): case A at confidence medium.
exports.listProducts = async (req, res) => {
  try {
    res.json(await Product.find());
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// Shape only, a class method: case B at confidence medium.
class OrderController {
  async create(req, res) {
    try {
      res.status(201).json(await Product.create(req.body));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = { app, OrderController };
