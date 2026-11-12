// A model module for the fix-preview fixtures in fix/passwords/: its schema has a password field.
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, minlength: [8, "Password must be at least 8 characters"] },
});

module.exports = mongoose.model("User", userSchema);
