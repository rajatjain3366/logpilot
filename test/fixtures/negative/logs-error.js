// Negative fixture for LP001: a catch block that logs the error. Must NOT be reported.
// The string and the comment below mention "catch (e) {}" on purpose: a plain text search
// would wrongly match them, but LogPilot reads the syntax tree, so it does not.

const EXAMPLE = "try { work(); } catch (e) {}";
// Old code used to be: try { work(); } catch (e) {}

function parseConfig(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("Failed to parse config", err);
    return {};
  }
}

module.exports = { EXAMPLE, parseConfig };
