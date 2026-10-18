import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, transaction } from '../db.js';
import { requireAdmin } from '../auth.js';
import { isClientUser } from '../access.js';

// Clients are companies shared across projects (project_clients). Admins manage them and their portal logins.
export const clientsRouter = Router();

const nowIso = () => new Date().toISOString();
const projectsOf = db.prepare(`
  SELECT p.id, p.name FROM project_clients pc JOIN projects p ON p.id = pc.project_id
  WHERE pc.client_id = ? AND p.deleted_at IS NULL ORDER BY p.name`);
const withDetails = (c) => ({
  ...c,
  projects: projectsOf.all(c.id),
  portal_users: db.prepare(`SELECT COUNT(*) n FROM users WHERE role = 'client' AND client_id = ? AND deleted_at IS NULL`).get(c.id).n,
});

// ?project_id=… → clients linked to that project (task form). Otherwise all clients.
// Client users only ever get their own company.
clientsRouter.get('/', (req, res) => {
  const { project_id } = req.query;
  if (isClientUser(req.user)) {
    const own = db.prepare('SELECT id, name FROM clients WHERE id = ? AND deleted_at IS NULL').get(req.user.client_id);
    return res.json(own ? [own] : []);
  }
  const rows = project_id
    ? db.prepare(`SELECT c.* FROM clients c JOIN project_clients pc ON pc.client_id = c.id
        WHERE pc.project_id = ? AND c.deleted_at IS NULL ORDER BY c.name`).all(project_id)
    : db.prepare('SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY name').all();
  res.json(rows.map(withDetails));
});

function readClient(req) {
  const name = req.body?.name?.trim();
  if (!name) return { error: 'Client name is required' };
  const projectIds = Array.isArray(req.body?.project_ids) ? [...new Set(req.body.project_ids.map(Number))] : null;
  if (projectIds) {
    const valid = db.prepare('SELECT id FROM projects WHERE deleted_at IS NULL').all().map((p) => p.id);
    if (projectIds.some((id) => !valid.includes(id))) return { error: 'Unknown project selected' };
  }
  return { name, email: req.body?.email?.trim() || null, phone: req.body?.phone?.trim() || null, projectIds };
}

const duplicateName = (name, exceptId = 0) => db.prepare(
  'SELECT id FROM clients WHERE lower(trim(name)) = lower(?) AND deleted_at IS NULL AND id != ?',
).get(name, exceptId);

function setProjects(clientId, projectIds) {
  db.prepare('DELETE FROM project_clients WHERE client_id = ?').run(clientId);
  const link = db.prepare('INSERT OR IGNORE INTO project_clients (project_id, client_id) VALUES (?, ?)');
  for (const id of projectIds) link.run(id, clientId);
}

clientsRouter.post('/', requireAdmin, (req, res) => {
  const c = readClient(req);
  if (c.error) return res.status(400).json({ message: c.error });
  if (duplicateName(c.name)) return res.status(409).json({ message: `A client named "${c.name}" already exists — add it to more projects instead` });
  const id = transaction(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO clients (name, email, phone, created_at) VALUES (?, ?, ?, ?)')
      .run(c.name, c.email, c.phone, nowIso());
    if (c.projectIds) setProjects(lastInsertRowid, c.projectIds);
    return lastInsertRowid;
  });
  res.status(201).json(withDetails(db.prepare('SELECT * FROM clients WHERE id = ?').get(id)));
});

clientsRouter.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Client not found' });
  const c = readClient(req);
  if (c.error) return res.status(400).json({ message: c.error });
  if (duplicateName(c.name, existing.id)) return res.status(409).json({ message: `Another client is already named "${c.name}"` });
  transaction(() => {
    db.prepare('UPDATE clients SET name = ?, email = ?, phone = ? WHERE id = ?').run(c.name, c.email, c.phone, existing.id);
    if (c.projectIds) setProjects(existing.id, c.projectIds);
  });
  res.json(withDetails(db.prepare('SELECT * FROM clients WHERE id = ?').get(existing.id)));
});

// Add to / remove from one project (the Projects page). Removing only unlinks; the company stays.
clientsRouter.post('/:id/projects/:projectId', requireAdmin, (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(req.params.projectId);
  if (!client || !project) return res.status(404).json({ message: 'Client or project not found' });
  db.prepare('INSERT OR IGNORE INTO project_clients (project_id, client_id) VALUES (?, ?)').run(project.id, client.id);
  res.status(204).end();
});

clientsRouter.delete('/:id/projects/:projectId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM project_clients WHERE client_id = ? AND project_id = ?').run(req.params.id, req.params.projectId);
  res.status(204).end();
});

// Soft delete (restorable from Trash). Its portal users can't sign in while it's deleted.
clientsRouter.delete('/:id', requireAdmin, (req, res) => {
  const { changes } = db.prepare('UPDATE clients SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(nowIso(), req.params.id);
  if (!changes) return res.status(404).json({ message: 'Client not found' });
  res.status(204).end();
});

/* ---------- Portal logins for a client company ---------- */

const MIN_PASSWORD = 8;
const selectPortalUser = `SELECT id, name, username, client_id, created_at FROM users WHERE role = 'client' AND deleted_at IS NULL`;

function usernameError(username, exceptId = 0) {
  const taken = db.prepare('SELECT deleted_at FROM users WHERE username = ? AND id != ?').get(username, exceptId);
  if (!taken) return null;
  return taken.deleted_at ? 'Username belongs to a deleted account; restore it from Trash' : 'Username already taken';
}

clientsRouter.get('/:id/users', requireAdmin, (req, res) => {
  res.json(db.prepare(`${selectPortalUser} AND client_id = ? ORDER BY name`).all(req.params.id));
});

clientsRouter.post('/:id/users', requireAdmin, (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const name = req.body?.name?.trim();
  const username = req.body?.username?.trim();
  const { password } = req.body ?? {};
  if (!name || !username || !password) return res.status(400).json({ message: 'Name, username and password are required' });
  if (password.length < MIN_PASSWORD) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
  const taken = usernameError(username);
  if (taken) return res.status(409).json({ message: taken });
  const { lastInsertRowid } = db.prepare(`INSERT INTO users (name, username, password_hash, role, client_id) VALUES (?, ?, ?, 'client', ?)`)
    .run(name, username, bcrypt.hashSync(password, 10), client.id);
  res.status(201).json(db.prepare(`${selectPortalUser} AND id = ?`).get(lastInsertRowid));
});

clientsRouter.put('/users/:userId', requireAdmin, (req, res) => {
  const user = db.prepare(`${selectPortalUser} AND id = ?`).get(req.params.userId);
  if (!user) return res.status(404).json({ message: 'Portal user not found' });
  const name = req.body?.name?.trim();
  const username = req.body?.username?.trim();
  const { password } = req.body ?? {};
  if (!name || !username) return res.status(400).json({ message: 'Name and username are required' });
  const taken = usernameError(username, user.id);
  if (taken) return res.status(409).json({ message: taken });
  if (password) {
    if (password.length < MIN_PASSWORD) return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  }
  db.prepare('UPDATE users SET name = ?, username = ? WHERE id = ?').run(name, username, user.id);
  res.json(db.prepare(`${selectPortalUser} AND id = ?`).get(user.id));
});

clientsRouter.delete('/users/:userId', requireAdmin, (req, res) => {
  const { changes } = db.prepare(`UPDATE users SET deleted_at = ? WHERE id = ? AND role = 'client' AND deleted_at IS NULL`)
    .run(nowIso(), req.params.userId);
  if (!changes) return res.status(404).json({ message: 'Portal user not found' });
  res.status(204).end();
});
