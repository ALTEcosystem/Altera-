const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'altera_dev_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'altera_refresh_dev_secret';

function generateTokens(userId) {
  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '60m' });
  const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { token, refreshToken };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  try {
    const payload = verifyToken(auth.slice(7));
    req.userId = payload.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = { generateTokens, verifyToken, verifyRefreshToken, authMiddleware };
