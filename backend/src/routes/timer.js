import { db } from '../db.js';

export const runningEntry = (taskId) =>
  db.prepare('SELECT * FROM time_entries WHERE task_id = ? AND ended_at IS NULL').get(taskId);

export function startTimer(taskId, userId) {
  if (runningEntry(taskId)) return null;
  const { lastInsertRowid } = db.prepare('INSERT INTO time_entries (task_id, user_id, started_at) VALUES (?, ?, ?)')
    .run(taskId, userId, new Date().toISOString());
  return lastInsertRowid;
}

export function stopTimer(taskId) {
  const entry = runningEntry(taskId);
  if (!entry) return null;
  // Never end before it started (e.g. a slot whose start was edited forward)
  const end = new Date(Math.max(Date.now(), new Date(entry.started_at).getTime() + 1000)).toISOString();
  db.prepare('UPDATE time_entries SET ended_at = ? WHERE id = ?').run(end, entry.id);
  return entry.id;
}
