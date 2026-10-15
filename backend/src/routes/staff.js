import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { STAFF_ROLES } from './tasks.js';

// Marketing and Support accounts (mounted behind requireAdmin)
export const staffRouter = Router();

const MIN_PASSWORD = 8;
const selectStaff = `
  SELECT u.id, u.username, u.name, u.role, u.created_at,
    (SELECT COUNT(*) FROM tasks t WHERE t.created_by = u.id AND t.deleted_at IS NULL) AS tasks_created
  FROM users u WHERE u.role IN ('marketing','support') AND u.deleted_at IS NULL`;

function usernameError(username, exceptId = 0) {
  const taken = db.prepare('SELECT deleted_at FROM users WHERE username = ? AND id != ?').get(username, exceptId);
  if (!taken) return null;
  return taken.deleted_at ? 'Username belongs to a deleted account; restore it from Trash' : 'Username already taken';
}

function readBody(req, { passwordRequired }) {
  const name = req.body?.name?.trim();
  const username = req.body?.username?.trim();
  const { password, role } = req.body ?? {};
  if (!name || !username) return { error: 'Name and username are required' };
  if (!STAFF_ROLES.includes(role)) return { error: 'Role must be Marketing or Support' };
  if (passwordRequired && !password) return { error: 'Password is required' };
  if (password && password.length < MIN_PASSWORD) return { error: `Password must be at least ${MIN_PASSWORD} characters` };
  return { name, username, password, role };
}

staffRouter.get('/', (req, res) => res.json(db.prepare(`${selectStaff} ORDER BY u.role, u.name`).all()));

staffRouter.post('/', (req, res) => {
  const b = readBody(req, { passwordRequired: true });
  if (b.error) return res.status(400).json({ message: b.error });
  const taken = usernameError(b.username);
  if (taken) return res.status(409).json({ message: taken });
  const { lastInsertRowid } = db.prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(b.name, b.username, bcrypt.hashSync(b.password, 10), b.role);
  res.status(201).json(db.prepare(`${selectStaff} AND u.id = ?`).get(lastInsertRowid));
});

staffRouter.put('/:id', (req, res) => {
  const member = db.prepare(`${selectStaff} AND u.id = ?`).get(req.params.id);
  if (!member) return res.status(404).json({ message: 'Team member not found' });
  const b = readBody(req, { passwordRequired: false });
  if (b.error) return res.status(400).json({ message: b.error });
  const taken = usernameError(b.username, member.id);
  if (taken) return res.status(409).json({ message: taken });
  if (b.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(b.password, 10), member.id);
  db.prepare('UPDATE users SET name = ?, username = ?, role = ? WHERE id = ?').run(b.name, b.username, b.role, member.id);
  res.json(db.prepare(`${selectStaff} AND u.id = ?`).get(member.id));
});

// Soft delete: restorable from Trash
staffRouter.delete('/:id', (req, res) => {
  const { changes } = db.prepare(`UPDATE users SET deleted_at = ? WHERE id = ? AND role IN ('marketing','support') AND deleted_at IS NULL`)
    .run(new Date().toISOString(), req.params.id);
  if (!changes) return res.status(404).json({ message: 'Team member not found' });
  res.status(204).end();
});
