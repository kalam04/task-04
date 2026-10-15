import { Router } from 'express';
import { db, transaction } from '../db.js';
import { adminIds, logActivity, notify } from '../activity.js';
import { getTask, isStaff } from './tasks.js';

// Assignment requests: Marketing/Support (or an admin) ask a developer to take an unassigned task;
// the developer accepts (the task is assigned to them) or declines with a reason.
export const requestsRouter = Router();

const nowIso = () => new Date().toISOString();
const getRequest = (id) => db.prepare('SELECT * FROM assignment_requests WHERE id = ?').get(id);

export function createRequest(user, task, developerId, message) {
  if (!isStaff(user) && user.role !== 'admin') return { error: 'Only Marketing, Support or an admin can request a developer' };
  if (task.developer_id) return { error: 'This task is already assigned' };
  if (!['pending', 'in_progress'].includes(task.status)) return { error: 'Only open tasks can be requested' };
  if (task.request_id) return { error: `A request to ${task.request_developer_name} is already pending` };
  const dev = db.prepare(`SELECT id, name FROM users WHERE id = ? AND role = 'developer' AND deleted_at IS NULL`).get(developerId);
  if (!dev) return { error: 'Choose a developer' };
  const note = typeof message === 'string' ? message.trim().slice(0, 2000) || null : null;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO assignment_requests (task_id, developer_id, requested_by, message, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(task.id, dev.id, user.id, note, nowIso());
  logActivity(task.id, user.id, `asked ${dev.name} to take the task${note ? `: "${note}"` : ''}`);
  notify([dev.id], {
    taskId: task.id, actorId: user.id, type: 'request',
    message: `${user.name} asked you to take "${task.title}"${note ? `: ${note.length > 80 ? `${note.slice(0, 80)}…` : note}` : ''}`,
  });
  return { id: lastInsertRowid };
}

// Called when a task gets assigned some other way
export function cancelPendingRequests(taskId, actorId, why) {
  const pending = db.prepare(`SELECT r.*, u.name AS dev_name FROM assignment_requests r JOIN users u ON u.id = r.developer_id
    WHERE r.task_id = ? AND r.status = 'pending'`).all(taskId);
  for (const r of pending) {
    db.prepare(`UPDATE assignment_requests SET status = 'cancelled', response = ?, responded_at = ? WHERE id = ?`).run(why, nowIso(), r.id);
    notify([r.developer_id, r.requested_by], {
      taskId, actorId, type: 'request_cancelled', message: `The request for ${r.dev_name} on a task was cancelled: ${why}`,
    });
  }
}

const listSql = `
  SELECT r.id, r.task_id, r.developer_id, r.requested_by, r.message, r.status, r.response, r.created_at, r.responded_at,
    t.title AS task_title, t.priority, t.due_date, p.name AS project_name,
    d.name AS developer_name, rb.name AS requested_by_name
  FROM assignment_requests r
  JOIN tasks t ON t.id = r.task_id AND t.deleted_at IS NULL
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users d ON d.id = r.developer_id
  LEFT JOIN users rb ON rb.id = r.requested_by`;

// Developers: requests waiting for them. Everyone else: the pending requests they made (admins: all pending)
requestsRouter.get('/', (req, res) => {
  const { role, id } = req.user;
  const rows = role === 'developer'
    ? db.prepare(`${listSql} WHERE r.developer_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`).all(id)
    : role === 'admin'
      ? db.prepare(`${listSql} WHERE r.status = 'pending' ORDER BY r.created_at DESC`).all()
      : db.prepare(`${listSql} WHERE r.requested_by = ? AND r.status = 'pending' ORDER BY r.created_at DESC`).all(id);
  res.json(rows);
});

requestsRouter.post('/', (req, res) => {
  const task = getTask(req.body?.task_id);
  if (!task) return res.status(404).json({ message: 'Task not found' });
  const result = createRequest(req.user, task, req.body?.developer_id, req.body?.message);
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(201).json(getTask(task.id));
});

function loadPending(req, res) {
  const r = getRequest(req.params.id);
  if (!r) {
    res.status(404).json({ message: 'Request not found' });
    return null;
  }
  if (r.status !== 'pending') {
    res.status(409).json({ message: `This request was already ${r.status}` });
    return null;
  }
  return r;
}

requestsRouter.post('/:id/accept', (req, res) => {
  const r = loadPending(req, res);
  if (!r) return;
  if (r.developer_id !== req.user.id) return res.status(403).json({ message: 'This request is for another developer' });
  const task = getTask(r.task_id);
  if (!task) return res.status(404).json({ message: 'Task not found' });
  const ok = transaction(() => {
    // Guarded: only if nobody assigned the task in the meantime
    const { changes } = db.prepare(`UPDATE tasks SET developer_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND developer_id IS NULL AND deleted_at IS NULL`).run(req.user.id, task.id);
    db.prepare(`UPDATE assignment_requests SET status = ?, response = ?, responded_at = ? WHERE id = ?`)
      .run(changes ? 'accepted' : 'cancelled', changes ? null : 'task was already assigned', nowIso(), r.id);
    return changes > 0;
  });
  if (!ok) return res.status(409).json({ message: 'Someone else was assigned this task in the meantime' });
  logActivity(task.id, req.user.id, 'accepted the request and took the task');
  notify([r.requested_by, ...adminIds()], {
    taskId: task.id, actorId: req.user.id, type: 'request_accepted',
    message: `${req.user.name} accepted "${task.title}" and is now assigned`,
  });
  res.json(getTask(task.id));
});

requestsRouter.post('/:id/decline', (req, res) => {
  const r = loadPending(req, res);
  if (!r) return;
  if (r.developer_id !== req.user.id) return res.status(403).json({ message: 'This request is for another developer' });
  const reason = req.body?.reason?.trim();
  if (!reason) return res.status(400).json({ message: 'Please give a reason for declining' });
  db.prepare(`UPDATE assignment_requests SET status = 'declined', response = ?, responded_at = ? WHERE id = ?`)
    .run(reason.slice(0, 2000), nowIso(), r.id);
  const task = getTask(r.task_id);
  logActivity(r.task_id, req.user.id, `declined the request: "${reason}"`);
  notify([r.requested_by], {
    taskId: r.task_id, actorId: req.user.id, type: 'request_declined',
    message: `${req.user.name} declined "${task?.title ?? 'a task'}": ${reason.length > 80 ? `${reason.slice(0, 80)}…` : reason}`,
  });
  res.json(task);
});

// The person who asked, or an admin, can withdraw a pending request
requestsRouter.post('/:id/cancel', (req, res) => {
  const r = loadPending(req, res);
  if (!r) return;
  if (r.requested_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only the person who asked or an admin can cancel this request' });
  }
  db.prepare(`UPDATE assignment_requests SET status = 'cancelled', response = 'withdrawn', responded_at = ? WHERE id = ?`).run(nowIso(), r.id);
  logActivity(r.task_id, req.user.id, 'cancelled the developer request');
  notify([r.developer_id], {
    taskId: r.task_id, actorId: req.user.id, type: 'request_cancelled',
    message: `${req.user.name} withdrew their request for you to take a task`,
  });
  res.json(getTask(r.task_id));
});
