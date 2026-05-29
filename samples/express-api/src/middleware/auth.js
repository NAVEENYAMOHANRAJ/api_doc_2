function requireAuth(req, res, next) {
  const token = req.headers["authorization"];
  if (!token || !token.startsWith("Bearer ")) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: "Missing bearer token" });
  }
  next();
}

module.exports = { requireAuth };
