// Fix-preview fixture for LP003: axios errors contain the request's headers (including
// Authorization), so a try block that calls axios gets no fix. See test/lp003-fix.test.ts.

const express = require("express");
const axios = require("axios");

const router = express.Router();
const payments = axios.create({ baseURL: "https://payments.example.com" });

// 1. The try calls axios through an instance made with axios.create(): no fix.
router.post("/pay", async (req, res) => {
  try {
    const result = await payments.post("/charges", { amount: 100 });
    res.json(result.data);
  } catch (err) {
    res.status(502).json({ message: "Payment failed" });
  }
});

// 2. The try calls axios directly: no fix.
router.get("/rates", async (req, res) => {
  try {
    res.json((await axios.get("https://rates.example.com/today")).data);
  } catch (err) {
    res.status(502).json({ message: "Rates unavailable" });
  }
});

// 3. This try does not call axios: a fix, with a note that the file imports axios.
router.get("/local", async (req, res) => {
  try {
    res.json(await loadLocal());
  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

module.exports = router;
