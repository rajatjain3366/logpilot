// A project logger module, used by the fix-preview fixture one-hop-require.js.
const pino = require("pino");

module.exports = pino({ level: process.env.LOG_LEVEL || "info" });
