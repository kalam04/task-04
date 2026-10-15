import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

export const authRouter = Router();

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name || u.username, role: u.role });

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!user) return res.status(401).json({ message: 'User no longer exists' });
    req.user = publicUser(user);
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  next();
}

// Brute-force protection: too many wrong passwords for one username from one IP locks it for a while
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
const failedLogins = new Map(); // `${ip}|${username}` -> { count, firstAt }

function loginLocked(key) {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOCK_MINUTES * 60_000) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}

function recordFailedLogin(key) {
  const entry = failedLogins.get(key) ?? { count: 0, firstAt: Date.now() };
  entry.count += 1;
  failedLogins.set(key, entry);
}

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }
  const key = `${req.ip}|${String(username).toLowerCase()}`;
  if (loginLocked(key)) {
    return res.status(429).json({ message: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.` });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedLogin(key);
    return res.status(401).json({ message: 'Invalid username or password' });
  }
  failedLogins.delete(key);
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Any signed-in user can change their own password
authRouter.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body ?? {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!current_password || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(400).json({ message: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ message: 'New password must be different from the current one' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ message: 'Password changed' });
});
