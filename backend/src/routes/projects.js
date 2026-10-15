import { Router } from 'express';
import { db, now, transaction } from '../db.js';
import { requireAdmin } from '../auth.js';

export const projectsRouter = Router();

projectsRouter.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM clients c WHERE c.project_id = p.id AND c.deleted_at IS NULL) AS client_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS task_count
    FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.name
  `).all();
  res.json(projects);
});

projectsRouter.post('/', requireAdmin, (req, res) => {
  const { name, description } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ message: 'Project name is required' });
  const { lastInsertRowid } = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)')
    .run(name.trim(), description || null);
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(lastInsertRowid));
});

projectsRouter.put('/:id', requireAdmin, (req, res) => {
  const { name, description } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ message: 'Project name is required' });
  const { changes } = db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ? AND deleted_at IS NULL')
    .run(name.trim(), description || null, req.params.id);
  if (!changes) return res.status(404).json({ message: 'Project not found' });
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id));
});

// Soft delete: the project's clients and tasks go to the Trash with it (same timestamp,
// so restoring the project brings them back together).
projectsRouter.delete('/:id', requireAdmin, (req, res) => {
  const ts = now();
  const changes = transaction(() => {
    const { changes } = db.prepare('UPDATE projects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, req.params.id);
    if (changes) {
      db.prepare('UPDATE clients SET deleted_at = ? WHERE project_id = ? AND deleted_at IS NULL').run(ts, req.params.id);
      db.prepare('UPDATE tasks SET deleted_at = ? WHERE project_id = ? AND deleted_at IS NULL').run(ts, req.params.id);
    }
    return changes;
  });
  if (!changes) return res.status(404).json({ message: 'Project not found' });
  res.status(204).end();
});
