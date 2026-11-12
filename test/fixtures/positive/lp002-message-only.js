// Positive fixture for LP002: the new error keeps only part of the caught error, as text.
// Each throw below must be reported with severity "medium", confidence "high" (case P2).

class UploadError extends Error {}

function readSettings(fs, path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Failed to read settings: ${err.message}`);
  }
}

function connect(client) {
  try {
    client.connect();
  } catch (err) {
    throw new Error("Connection failed: " + err);
  }
}

function upload(storage, file) {
  try {
    storage.put(file);
  } catch (err) {
    throw new UploadError(String(err));
  }
}

// Error(err) turns err into the text "Error: ..." and drops everything else.
function loadPlugin(name) {
  try {
    return require(name);
  } catch (err) {
    throw new Error(err);
  }
}

function openFile(file) {
  try {
    return file.open();
  } catch (error) {
    throw new TypeError(`Could not open file (${error.code})`);
  }
}

module.exports = { readSettings, connect, upload, loadPlugin, openFile };
