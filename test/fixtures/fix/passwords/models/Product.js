// A model module for the fix-preview fixtures in fix/passwords/: no password-like field.
const { Schema, model } = require("mongoose");

module.exports = model("Product", new Schema({ title: String, price: Number }));
