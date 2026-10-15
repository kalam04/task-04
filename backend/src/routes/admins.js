import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';

// Admin accounts (mounted behind requireAdmin)
export const adminsRouter = Router();

const MIN_PASSWORD = 8;
const selectAdmin = `SELECT id, username, name, created_at FROM users WHERE role = 'admin' AND deleted_at IS NULL`;
const activeAdminCount = () => db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND deleted_at IS NULL`).get().n;

function usernameError(username, exceptId = 0) {
  const taken = db.prepare('SELECT deleted_at FROM users WHERE username = ? AND id != ?').get(username, exceptId);
  if (!taken) return null;
  return taken.deleted_at ? 'Username belongs to a deleted account; restore it from Trash' : 'Username already taken';
}

adminsRouter.get('/', (req, res) => {
  res.json(db.prepare(`${selectAdmin} ORDER BY name`).all().map((a) => ({ ...a, is_you: a.id === req.user.id })));
});

adminsRouter.post('/', (req, res) => {
  const name = req.body?.name?.trim();
  const username = req.body?.username?.trim();
  const { password } = req.body ?? {};
  if (!name || !username || !password) return res.status(400).json({ message: 'Name, username and password are required' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
  const error = usernameError(username);
  if (error) return res.status(409).json({ message: error });
  const { lastInsertRowid } = db.prepare(`INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'admin')`)
    .run(name, username, bcrypt.hashSync(password, 10));
  res.status(201).json(db.prepare(`${selectAdmin} AND id = ?`).get(lastInsertRowid));
});

adminsRouter.put('/:id', (req, res) => {
  const admin = db.prepare(`${selectAdmin} AND id = ?`).get(req.params.id);
  if (!admin) return res.status(404).json({ message: 'Admin not found' });
  const name = req.body?.name?.trim();
  const username = req.body?.username?.trim();
  const { password } = req.body ?? {};
  if (!name || !username) return res.status(400).json({ message: 'Name and username are required' });
  const error = usernameError(username, admin.id);
  if (error) return res.status(409).json({ message: error });
  if (password) {
    if (password.length < MIN_PASSWORD) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), admin.id);
  }
  db.prepare('UPDATE users SET name = ?, username = ? WHERE id = ?').run(name, username, admin.id);
  res.json(db.prepare(`${selectAdmin} AND id = ?`).get(admin.id));
});

// Soft delete (restorable from Trash). Never yourself, never the last admin.
adminsRouter.delete('/:id', (req, res) => {
  const admin = db.prepare(`${selectAdmin} AND id = ?`).get(req.params.id);
  if (!admin) return res.status(404).json({ message: 'Admin not found' });
  if (admin.id === req.user.id) return res.status(400).json({ message: "You can't delete your own account" });
  if (activeAdminCount() <= 1) return res.status(400).json({ message: 'There must be at least one admin' });
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), admin.id);
  res.status(204).end();
});
