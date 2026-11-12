// Positive fixture for LP003: responses sent through a helper function defined in the same file.
// The helpers only answer; they never log, so the error is lost all the same.

const express = require("express");
const Video = require("./models/video");

const app = express();

function errorResponse(res, status, message) {
  res.status(status).json({ error: message });
}

const bad = (res, code, detail) => res.status(code).json({ detail });

// Case A: no error variable, and the helper sends a 502.
app.delete("/videos/:id", async (req, res) => {
  try {
    await Video.remove(req.params.id);
    res.json({ ok: true });
  } catch {
    return errorResponse(res, 502, "Storage cleanup is pending.");
  }
});

// Case B: the error message goes to the client through the helper.
app.get("/videos", async (req, res) => {
  try {
    res.json(await Video.find());
  } catch (err) {
    bad(res, 502, err.message);
  }
});

// Error middleware that answers through the helper and never logs (case A).
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError) return errorResponse(res, 400, "Invalid request body.");
  return errorResponse(res, 500, "The server could not complete this request.");
});

module.exports = app;
