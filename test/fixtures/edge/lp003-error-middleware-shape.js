// Edge fixture for LP003: error middleware recognised only by its shape (exported from its own
// file and registered elsewhere): reported with confidence medium.

module.exports = (err, req, res, next) => {
  res.status(500).send("Server error");
};
