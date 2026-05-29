const express = require("express");
const router = express.Router();

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "INVALID_CREDENTIALS", message: "Email and password are required" });
  }
  res.status(200).json({ accessToken: "jwt-token", tokenType: "Bearer", expiresIn: 3600 });
});

module.exports = router;
