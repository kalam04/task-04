import { db } from './db.js';

const nowIso = () => new Date().toISOString();

export const userName = (id) => db.prepare('SELECT name, username FROM users WHERE id = ?').get(id)?.name ?? 'Someone';
export const adminIds = () => db.prepare(`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL`).all().map((r) => r.id);

// History line shown on the task, e.g. "<user> changed status from Pending to In Progress"
export function logActivity(taskId, userId, message) {
  db.prepare('INSERT INTO task_activity (task_id, user_id, message, created_at) VALUES (?, ?, ?, ?)')
    .run(taskId, userId ?? null, message, nowIso());
}

// Sends a notification to each user except the one who caused it.
// With a dedupeKey, a user gets that notification at most once.
export function notify(userIds, { taskId = null, actorId = null, type, message, dedupeKey = null }) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO notifications (user_id, task_id, actor_id, type, message, dedupe_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const id of new Set(userIds.filter(Boolean))) {
    if (id === actorId) continue;
    insert.run(id, taskId, actorId, type, message, dedupeKey, nowIso());
  }
}

export const STATUS_LABELS = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', rejected: 'Rejected' };
export const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

// Once an hour: tell the assignee about open tasks that are past their due date (once per task + due date)
export function checkOverdue() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const overdue = db.prepare(`
    SELECT id, title, developer_id, due_date FROM tasks
    WHERE deleted_at IS NULL AND developer_id IS NOT NULL AND due_date IS NOT NULL AND due_date < ?
      AND status IN ('pending','in_progress')`).all(today);
  for (const t of overdue) {
    notify([t.developer_id], {
      taskId: t.id, type: 'overdue', dedupeKey: `overdue:${t.id}:${t.due_date}`,
      message: `"${t.title}" is overdue (was due ${t.due_date})`,
    });
  }
}
