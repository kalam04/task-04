import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

export const developersRouter = Router();

const selectDeveloper = `
  SELECT u.id, u.username, u.name, u.created_at,
    (SELECT COUNT(*) FROM tasks t WHERE t.developer_id = u.id AND t.deleted_at IS NULL AND t.status IN ('pending','in_progress')) AS open_tasks,
    (SELECT COUNT(*) FROM tasks t WHERE t.developer_id = u.id AND t.deleted_at IS NULL AND t.status = 'completed') AS completed_tasks
  FROM users u WHERE u.role = 'developer' AND u.deleted_at IS NULL`;

// Any signed-in user can list developers (needed for assignment dropdowns)
developersRouter.get('/', (req, res) => {
  if (req.user.role === 'client') return res.json([]);
  res.json(db.prepare(`${selectDeveloper} ORDER BY u.name`).all());
});

developersRouter.post('/', requireAdmin, (req, res) => {
  const { name, username, password } = req.body ?? {};
  if (!name?.trim() || !username?.trim() || !password) {
    return res.status(400).json({ message: 'Name, username and password are required' });
  }
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  const taken = db.prepare('SELECT deleted_at FROM users WHERE username = ?').get(username.trim());
  if (taken) {
    return res.status(409).json({
      message: taken.deleted_at ? 'Username belongs to a deleted developer; restore them from Trash' : 'Username already taken',
    });
  }
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, 'developer')`
  ).run(name.trim(), username.trim(), bcrypt.hashSync(password, 10));
  res.status(201).json(db.prepare(`${selectDeveloper} AND u.id = ?`).get(lastInsertRowid));
});

developersRouter.put('/:id', requireAdmin, (req, res) => {
  const { name, username, password } = req.body ?? {};
  if (!name?.trim() || !username?.trim()) return res.status(400).json({ message: 'Name and username are required' });
  const dev = db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'developer' AND deleted_at IS NULL`).get(req.params.id);
  if (!dev) return res.status(404).json({ message: 'Developer not found' });
  if (db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username.trim(), dev.id)) {
    return res.status(409).json({ message: 'Username already taken' });
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), dev.id);
  }
  db.prepare('UPDATE users SET name = ?, username = ? WHERE id = ?').run(name.trim(), username.trim(), dev.id);
  res.json(db.prepare(`${selectDeveloper} AND u.id = ?`).get(dev.id));
});

developersRouter.delete('/:id', requireAdmin, (req, res) => {
  const { changes } = db.prepare(
    `UPDATE users SET deleted_at = ? WHERE id = ? AND role = 'developer' AND deleted_at IS NULL`
  ).run(new Date().toISOString(), req.params.id);
  if (!changes) return res.status(404).json({ message: 'Developer not found' });
  res.status(204).end();
});
