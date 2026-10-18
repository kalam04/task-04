import { db } from './db.js';

// Client portal users (role 'client') only ever see tasks of their own client company,
// in projects that company is linked to. Everyone else sees every task.
export const isClientUser = (user) => user?.role === 'client';

export const clientProjectIds = (clientId) =>
  db.prepare('SELECT project_id FROM project_clients WHERE client_id = ?').all(clientId).map((r) => r.project_id);

// SQL condition + params restricting tasks (alias t) for a client user; empty for everyone else
export function clientScope(user) {
  if (!isClientUser(user)) return { sql: '', params: [] };
  return {
    sql: 't.client_id = ? AND t.project_id IN (SELECT project_id FROM project_clients WHERE client_id = ?)',
    params: [user.client_id ?? -1, user.client_id ?? -1],
  };
}

export function canSeeTask(user, task) {
  if (!task) return false;
  if (!isClientUser(user)) return true;
  return task.client_id === user.client_id && clientProjectIds(user.client_id).includes(task.project_id);
}

export const clientUserIds = (clientId) => (clientId
  ? db.prepare(`SELECT id FROM users WHERE role = 'client' AND client_id = ? AND deleted_at IS NULL`).all(clientId).map((r) => r.id)
  : []);
