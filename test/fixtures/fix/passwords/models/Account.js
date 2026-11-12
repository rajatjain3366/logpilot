// A model module for the fix-preview fixtures in fix/passwords/.
const mongoose = require("mongoose");

module.exports = mongoose.model("Account", new mongoose.Schema({ owner: String, refreshToken: String }));
