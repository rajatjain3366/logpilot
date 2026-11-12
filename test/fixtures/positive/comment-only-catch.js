// Positive fixture for LP001: catch blocks that contain only a comment.
// Each catch below must be reported with severity "medium", confidence "medium".

function readCache(cache, key) {
  try {
    return cache.get(key);
  } catch (err) {
    // ignore: the cache is optional
  }
  return null;
}

function closeQuietly(connection) {
  try {
    connection.close();
  } catch (e) { /* already closed */ }
}

module.exports = { readCache, closeQuietly };
