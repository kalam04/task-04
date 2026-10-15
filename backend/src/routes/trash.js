import { Router } from 'express';
import { db, transaction } from '../db.js';
import { logActivity } from '../activity.js';

export const trashRouter = Router();

trashRouter.get('/', (req, res) => {
  const projects = db.prepare(`
    SELECT id, name, description, deleted_at,
      (SELECT COUNT(*) FROM clients c WHERE c.project_id = p.id AND c.deleted_at = p.deleted_at) AS client_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at = p.deleted_at) AS task_count
    FROM projects p WHERE deleted_at IS NOT NULL`).all();
  const clients = db.prepare(`
    SELECT c.id, c.name, c.email, c.deleted_at, p.name AS project_name, p.deleted_at IS NOT NULL AS project_deleted
    FROM clients c JOIN projects p ON p.id = c.project_id
    WHERE c.deleted_at IS NOT NULL`).all();
  const developers = db.prepare(`
    SELECT id, name, username, deleted_at FROM users
    WHERE role = 'developer' AND deleted_at IS NOT NULL`).all();
  const tasks = db.prepare(`
    SELECT t.id, t.title, t.status, t.priority, t.deleted_at, p.name AS project_name,
      p.deleted_at IS NOT NULL AS project_deleted
    FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.deleted_at IS NOT NULL`).all();
  const subtasks = db.prepare(`
    SELECT s.id, s.title, s.deleted_at, t.title AS task_title, t.deleted_at IS NOT NULL AS task_deleted
    FROM subtasks s JOIN tasks t ON t.id = s.task_id
    WHERE s.deleted_at IS NOT NULL`).all();
  const admins = db.prepare(`
    SELECT id, name, username, deleted_at FROM users
    WHERE role = 'admin' AND deleted_at IS NOT NULL`).all();
  const files = db.prepare(`
    SELECT f.id, f.original_name AS name, f.size, f.is_voice, f.deleted_at, t.title AS task_title, t.deleted_at IS NOT NULL AS task_deleted
    FROM task_attachments f JOIN tasks t ON t.id = f.task_id
    WHERE f.deleted_at IS NOT NULL`).all();
  const staff = db.prepare(`
    SELECT id, name, username, role, deleted_at FROM users
    WHERE role IN ('marketing','support') AND deleted_at IS NOT NULL`).all();
  res.json({ projects, clients, developers, admins, staff, tasks, subtasks, files });
});

const notFound = (res) => res.status(404).json({ message: 'Item not found in Trash' });
const projectDeletedFor = (table, id) => db.prepare(
  `SELECT p.deleted_at FROM ${table} x JOIN projects p ON p.id = x.project_id WHERE x.id = ?`
).get(id)?.deleted_at;

trashRouter.post('/projects/:id/restore', (req, res) => {
  const project = db.prepare('SELECT deleted_at FROM projects WHERE id = ? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!project) return notFound(res);
  transaction(() => {
    // Bring back the clients and tasks that were trashed together with the project
    db.prepare('UPDATE clients SET deleted_at = NULL WHERE project_id = ? AND deleted_at = ?').run(req.params.id, project.deleted_at);
    db.prepare('UPDATE tasks SET deleted_at = NULL WHERE project_id = ? AND deleted_at = ?').run(req.params.id, project.deleted_at);
    db.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  });
  res.json({ message: 'Project restored' });
});

for (const [type, table, label] of [['clients', 'clients', 'Client'], ['tasks', 'tasks', 'Task']]) {
  trashRouter.post(`/${type}/:id/restore`, (req, res) => {
    if (projectDeletedFor(table, req.params.id)) {
      return res.status(409).json({ message: `Its project is in the Trash; restore the project first` });
    }
    const { changes } = db.prepare(`UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`).run(req.params.id);
    if (!changes) return notFound(res);
    if (type === 'tasks') logActivity(Number(req.params.id), req.user.id, 'restored the task from Trash');
    res.json({ message: `${label} restored` });
  });
}

trashRouter.post('/developers/:id/restore', (req, res) => {
  const { changes } = db.prepare(
    `UPDATE users SET deleted_at = NULL WHERE id = ? AND role = 'developer' AND deleted_at IS NOT NULL`
  ).run(req.params.id);
  if (!changes) return notFound(res);
  res.json({ message: 'Developer restored' });
});

trashRouter.post('/subtasks/:id/restore', (req, res) => {
  const row = db.prepare(`
    SELECT t.deleted_at AS task_deleted FROM subtasks s JOIN tasks t ON t.id = s.task_id
    WHERE s.id = ? AND s.deleted_at IS NOT NULL`).get(req.params.id);
  if (!row) return notFound(res);
  if (row.task_deleted) return res.status(409).json({ message: 'Its task is in the Trash; restore the task first' });
  db.prepare('UPDATE subtasks SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  res.json({ message: 'Subtask restored' });
});

trashRouter.post('/admins/:id/restore', (req, res) => {
  const { changes } = db.prepare(
    `UPDATE users SET deleted_at = NULL WHERE id = ? AND role = 'admin' AND deleted_at IS NOT NULL`
  ).run(req.params.id);
  if (!changes) return notFound(res);
  res.json({ message: 'Admin restored' });
});

trashRouter.post('/files/:id/restore', (req, res) => {
  const row = db.prepare(`
    SELECT f.task_id, f.original_name, t.deleted_at AS task_deleted FROM task_attachments f JOIN tasks t ON t.id = f.task_id
    WHERE f.id = ? AND f.deleted_at IS NOT NULL`).get(req.params.id);
  if (!row) return notFound(res);
  if (row.task_deleted) return res.status(409).json({ message: 'Its task is in the Trash; restore the task first' });
  db.prepare('UPDATE task_attachments SET deleted_at = NULL WHERE id = ?').run(req.params.id);
  logActivity(row.task_id, req.user.id, `restored file "${row.original_name}" from Trash`);
  res.json({ message: 'File restored' });
});

trashRouter.post('/staff/:id/restore', (req, res) => {
  const { changes } = db.prepare(
    `UPDATE users SET deleted_at = NULL WHERE id = ? AND role IN ('marketing','support') AND deleted_at IS NOT NULL`
  ).run(req.params.id);
  if (!changes) return notFound(res);
  res.json({ message: 'Team member restored' });
});
