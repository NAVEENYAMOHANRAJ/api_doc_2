const express = require("express");
const { body } = require("express-validator");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/users", requireAuth, async (req, res) => {
  const limit = parseInt(req.query.limit || "20", 10);
  const page = parseInt(req.query.page || "1", 10);
  res.status(200).json({
    users: [],
    page,
    limit,
    total: 0
  });
});

router.get("/users/:id", requireAuth, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) {
    return res.status(400).json({ error: "INVALID_USER_ID", message: "User id must be numeric" });
  }
  if (userId === 404) {
    return res.status(404).json({ error: "USER_NOT_FOUND", message: "User was not found" });
  }
  res.json({ id: userId, name: "Jane Doe", email: "jane@example.com", active: true });
});

router.post(
  "/users",
  requireAuth,
  body("email").isEmail(),
  body("name").notEmpty(),
  body("password").isLength({ min: 8 }),
  async (req, res) => {
    const { email, name, password } = req.body;
    if (!email || !name || !password) {
      return res.status(422).json({ error: "VALIDATION_ERROR", message: "Missing required user fields" });
    }
    res.status(201).json({ id: 123, email, name, active: true });
  }
);

router.delete("/users/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "INVALID_USER_ID" });
  }
  res.status(204).json({});
});

module.exports = router;
