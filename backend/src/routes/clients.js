import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

export const clientsRouter = Router();

const projectExists = (id) => db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(id);

clientsRouter.get('/', (req, res) => {
  const { project_id } = req.query;
  const sql = `
    SELECT c.*, p.name AS project_name FROM clients c
    JOIN projects p ON p.id = c.project_id
    WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL ${project_id ? 'AND c.project_id = ?' : ''}
    ORDER BY c.name`;
  res.json(project_id ? db.prepare(sql).all(project_id) : db.prepare(sql).all());
});

clientsRouter.post('/', requireAdmin, (req, res) => {
  const { project_id, name, email, phone } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ message: 'Client name is required' });
  if (!projectExists(project_id)) return res.status(400).json({ message: 'Valid project is required' });
  const { lastInsertRowid } = db.prepare('INSERT INTO clients (project_id, name, email, phone) VALUES (?, ?, ?, ?)')
    .run(project_id, name.trim(), email || null, phone || null);
  res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(lastInsertRowid));
});

clientsRouter.put('/:id', requireAdmin, (req, res) => {
  const { project_id, name, email, phone } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ message: 'Client name is required' });
  if (!projectExists(project_id)) return res.status(400).json({ message: 'Valid project is required' });
  const { changes } = db.prepare('UPDATE clients SET project_id = ?, name = ?, email = ?, phone = ? WHERE id = ? AND deleted_at IS NULL')
    .run(project_id, name.trim(), email || null, phone || null, req.params.id);
  if (!changes) return res.status(404).json({ message: 'Client not found' });
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id));
});

clientsRouter.delete('/:id', requireAdmin, (req, res) => {
  const { changes } = db.prepare('UPDATE clients SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), req.params.id);
  if (!changes) return res.status(404).json({ message: 'Client not found' });
  res.status(204).end();
});
