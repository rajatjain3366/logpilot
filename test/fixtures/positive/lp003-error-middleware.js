// Positive fixture for LP003: error-handling middleware (err, req, res, next) that responds
// without using the error. Every error passed on with next(err) ends here, so none is recorded.

const express = require("express");

const app = express();

// Case A: a generic 500, the error is never used.
app.use((err, req, res, next) => {
  res.status(500).json({ message: "Internal server error" });
});

// Case B: the status and the message come from the error, but it is never logged.
app.use(function errorHandler(err, req, res, next) {
  res.status(err.statusCode || 500).json({ success: false, message: err.message });
});

// Case B, as an arrow function without braces.
app.use((err, req, res, next) => res.status(500).send(err.message));

module.exports = app;
