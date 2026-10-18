import { Router } from 'express';
import { db, transaction } from '../db.js';
import { canEditTask, getTask } from './tasks.js';
import { canSeeTask, clientUserIds } from '../access.js';
import { runningEntry, startTimer, stopTimer } from './timer.js';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { adminIds, logActivity, notify } from '../activity.js';
import { decodeName, maxUploadBytes, upload, uploadDir } from '../uploads.js';

// Mounted at /api/tasks/:taskId — subtasks and the time log of one task
export const taskDetailsRouter = Router({ mergeParams: true });

// Anyone signed in can read a task's subtasks and time log; only the assigned developer
// (or an admin) can change them.
taskDetailsRouter.use((req, res, next) => {
  const task = getTask(req.params.taskId);
  if (!canSeeTask(req.user, task)) return res.status(404).json({ message: 'Task not found' });
  // Comments and file attachments are open to anyone who can see the task
  const isShared = req.path.startsWith('/comments') || req.path.startsWith('/attachments');
  if (req.method !== 'GET' && !isShared && !canEditTask(req.user, task)) {
    return res.status(403).json({ message: 'Only the assigned developer or an admin can change this task' });
  }
  req.task = task;
  next();
});

const isAdmin = (req) => req.user.role === 'admin';

function requireEditable(...closedStatuses) {
  return (req, res, next) => {
    if (!isAdmin(req) && closedStatuses.includes(req.task.status)) {
      return res.status(403).json({ message: `This task is ${req.task.status}; ask an admin to reopen it` });
    }
    next();
  };
}

/* ---------- Subtasks ---------- */

const listSubtasks = (taskId) => db.prepare(
  'SELECT * FROM subtasks WHERE task_id = ? AND deleted_at IS NULL ORDER BY id'
).all(taskId);
const getSubtask = (req) => db.prepare(
  'SELECT * FROM subtasks WHERE id = ? AND task_id = ? AND deleted_at IS NULL'
).get(req.params.subtaskId, req.task.id);

taskDetailsRouter.get('/subtasks', (req, res) => res.json(listSubtasks(req.task.id)));

taskDetailsRouter.post('/subtasks', requireEditable('completed', 'rejected'), (req, res) => {
  const title = req.body?.title?.trim();
  if (!title) return res.status(400).json({ message: 'Subtask title is required' });
  const { lastInsertRowid } = db.prepare('INSERT INTO subtasks (task_id, title, created_by) VALUES (?, ?, ?)')
    .run(req.task.id, title, req.user.id);
  logActivity(req.task.id, req.user.id, `added subtask "${title}"`);
  res.status(201).json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(lastInsertRowid));
});

taskDetailsRouter.patch('/subtasks/:subtaskId', requireEditable('completed', 'rejected'), (req, res) => {
  const subtask = getSubtask(req);
  if (!subtask) return res.status(404).json({ message: 'Subtask not found' });
  const title = req.body?.title !== undefined ? req.body.title?.trim() : subtask.title;
  if (!title) return res.status(400).json({ message: 'Subtask title is required' });
  const isDone = req.body?.is_done !== undefined ? (req.body.is_done ? 1 : 0) : subtask.is_done;
  db.prepare(`
    UPDATE subtasks SET title = ?, is_done = ?,
      done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ?) ELSE NULL END
    WHERE id = ?`
  ).run(title, isDone, isDone, new Date().toISOString(), subtask.id);
  if (isDone !== subtask.is_done) {
    logActivity(req.task.id, req.user.id, `${isDone ? 'completed' : 'reopened'} subtask "${title}"`);
  }
  if (title !== subtask.title) logActivity(req.task.id, req.user.id, `renamed subtask "${subtask.title}" to "${title}"`);
  res.json(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(subtask.id));
});

// Soft delete: restorable from the Trash
taskDetailsRouter.delete('/subtasks/:subtaskId', requireEditable('completed', 'rejected'), (req, res) => {
  const subtask = getSubtask(req);
  if (!subtask) return res.status(404).json({ message: 'Subtask not found' });
  db.prepare('UPDATE subtasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), subtask.id);
  logActivity(req.task.id, req.user.id, `deleted subtask "${subtask.title}"`);
  res.status(204).end();
});

/* ---------- Time log ---------- */

const listEntries = (taskId) => db.prepare(`
  SELECT e.*, u.name AS user_name FROM time_entries e
  LEFT JOIN users u ON u.id = e.user_id
  WHERE e.task_id = ? ORDER BY e.started_at`
).all(taskId);

function parseTime(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Validates a slot and checks it doesn't overlap the task's other slots
function validateEntry(taskId, body, excludeId = 0) {
  const started_at = parseTime(body?.started_at);
  const ended_at = parseTime(body?.ended_at);
  if (!started_at || started_at === undefined || ended_at === undefined) return { error: 'A valid start time is required' };
  if (ended_at && ended_at <= started_at) return { error: 'End time must be after the start time' };
  const limit = new Date(Date.now() + 60_000).toISOString();
  if (started_at > limit || (ended_at && ended_at > limit)) return { error: 'Times cannot be in the future' };
  if (!ended_at && db.prepare('SELECT id FROM time_entries WHERE task_id = ? AND ended_at IS NULL AND id != ?').get(taskId, excludeId)) {
    return { error: 'A timer is already running for this task' };
  }
  const overlap = db.prepare(`
    SELECT id FROM time_entries
    WHERE task_id = ? AND id != ?
      AND started_at < COALESCE(?, '9999') AND COALESCE(ended_at, '9999') > ?`
  ).get(taskId, excludeId, ended_at, started_at);
  if (overlap) return { error: 'This time slot overlaps another slot' };
  return { started_at, ended_at, note: body?.note?.trim() || null };
}

taskDetailsRouter.get('/time-entries', (req, res) => res.json(listEntries(req.task.id)));

taskDetailsRouter.post('/time-entries', requireEditable('rejected'), (req, res) => {
  const v = validateEntry(req.task.id, req.body);
  if (v.error) return res.status(400).json({ message: v.error });
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO time_entries (task_id, user_id, started_at, ended_at, note) VALUES (?, ?, ?, ?, ?)'
  ).run(req.task.id, req.user.id, v.started_at, v.ended_at, v.note);
  logActivity(req.task.id, req.user.id, 'added a time slot manually');
  res.status(201).json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(lastInsertRowid));
});

taskDetailsRouter.put('/time-entries/:entryId', requireEditable('rejected'), (req, res) => {
  const entry = db.prepare('SELECT id FROM time_entries WHERE id = ? AND task_id = ?').get(req.params.entryId, req.task.id);
  if (!entry) return res.status(404).json({ message: 'Time slot not found' });
  const v = validateEntry(req.task.id, req.body, entry.id);
  if (v.error) return res.status(400).json({ message: v.error });
  db.prepare('UPDATE time_entries SET started_at = ?, ended_at = ?, note = ? WHERE id = ?')
    .run(v.started_at, v.ended_at, v.note, entry.id);
  logActivity(req.task.id, req.user.id, 'edited a time slot');
  res.json(db.prepare('SELECT * FROM time_entries WHERE id = ?').get(entry.id));
});

taskDetailsRouter.delete('/time-entries/:entryId', requireEditable('rejected'), (req, res) => {
  const { changes } = db.prepare('DELETE FROM time_entries WHERE id = ? AND task_id = ?').run(req.params.entryId, req.task.id);
  if (!changes) return res.status(404).json({ message: 'Time slot not found' });
  logActivity(req.task.id, req.user.id, 'deleted a time slot');
  res.status(204).end();
});

// Timer: start opens a new slot now (and moves a pending task to In Progress); stop closes it
taskDetailsRouter.post('/timer/start', requireEditable('completed', 'rejected'), (req, res) => {
  if (runningEntry(req.task.id)) return res.status(409).json({ message: 'Timer is already running' });
  transaction(() => {
    startTimer(req.task.id, req.user.id);
    if (req.task.status === 'pending') {
      db.prepare(`UPDATE tasks SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.task.id);
      logActivity(req.task.id, req.user.id, 'started working (Pending → In Progress)');
      notify(clientUserIds(req.task.client_id), {
        taskId: req.task.id, actorId: req.user.id, type: 'status', message: `"${req.task.title}" is now In Progress`,
      });
    }
  });
  res.json(getTask(req.task.id));
});

taskDetailsRouter.post('/timer/stop', requireEditable('rejected'), (req, res) => {
  if (!stopTimer(req.task.id)) return res.status(409).json({ message: 'No timer is running' });
  res.json(getTask(req.task.id));
});

/* ---------- Comments ---------- */

const listComments = (taskId) => db.prepare(`
  SELECT c.id, c.task_id, c.user_id, c.created_at, c.edited_at, c.deleted_at,
    CASE WHEN c.deleted_at IS NULL THEN c.body END AS body,
    u.name AS user_name, u.role AS user_role
  FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
  WHERE c.task_id = ? ORDER BY c.created_at`
).all(taskId);

taskDetailsRouter.get('/comments', (req, res) => res.json(listComments(req.task.id)));

// Anyone who can see the task can comment on it
taskDetailsRouter.post('/comments', (req, res) => {
  const body = req.body?.body?.trim();
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty' });
  if (body.length > 5000) return res.status(400).json({ message: 'Comment is too long (max 5000 characters)' });
  db.prepare('INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(req.task.id, req.user.id, body, new Date().toISOString());
  // Tell the assignee, the admins and everyone who already commented
  const commenters = db.prepare('SELECT DISTINCT user_id FROM task_comments WHERE task_id = ? AND deleted_at IS NULL')
    .all(req.task.id).map((r) => r.user_id);
  const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
  notify([req.task.developer_id, ...adminIds(), ...commenters, ...clientUserIds(req.task.client_id)], {
    taskId: req.task.id, actorId: req.user.id, type: 'comment',
    message: `${req.user.name} commented on "${req.task.title}": ${preview}`,
  });
  res.status(201).json(listComments(req.task.id));
});

// Only the author can edit; the author or an admin can delete (kept as "comment deleted" in the thread)
const getComment = (req) => db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ? AND deleted_at IS NULL')
  .get(req.params.commentId, req.task.id);

taskDetailsRouter.patch('/comments/:commentId', (req, res) => {
  const comment = getComment(req);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ message: 'You can only edit your own comments' });
  const body = req.body?.body?.trim();
  if (!body) return res.status(400).json({ message: 'Comment cannot be empty' });
  db.prepare('UPDATE task_comments SET body = ?, edited_at = ? WHERE id = ?').run(body, new Date().toISOString(), comment.id);
  res.json(listComments(req.task.id));
});

taskDetailsRouter.delete('/comments/:commentId', (req, res) => {
  const comment = getComment(req);
  if (!comment) return res.status(404).json({ message: 'Comment not found' });
  if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'You can only delete your own comments' });
  }
  db.prepare('UPDATE task_comments SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), comment.id);
  res.json(listComments(req.task.id));
});

/* ---------- History ---------- */

taskDetailsRouter.get('/activity', (req, res) => {
  if (req.user.role === 'client') return res.json([]);
  res.json(db.prepare(`
    SELECT a.id, a.message, a.created_at, u.name AS user_name FROM task_activity a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.task_id = ? ORDER BY a.created_at DESC, a.id DESC`
  ).all(req.task.id));
});

/* ---------- Attachments ---------- */

const FILE_LINK_TTL = '4h';
const fileUrl = (id) => `/api/files/${id}?token=${jwt.sign({ aid: id, typ: 'file' }, process.env.JWT_SECRET, { expiresIn: FILE_LINK_TTL })}`;

export const listAttachments = (taskId) => db.prepare(`
  SELECT a.id, a.original_name, a.mime_type, a.size, a.is_voice, a.created_at, a.user_id, u.name AS user_name
  FROM task_attachments a LEFT JOIN users u ON u.id = a.user_id
  WHERE a.task_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC, a.id DESC`
).all(taskId).map((a) => ({ ...a, url: fileUrl(a.id) }));

taskDetailsRouter.get('/attachments', (req, res) => res.json(listAttachments(req.task.id)));

taskDetailsRouter.post('/attachments', (req, res) => {
  upload.array('files')(req, res, (err) => {
    const files = req.files ?? [];
    const discard = () => files.forEach((f) => fs.rm(f.path, { force: true }, () => {}));
    if (err) {
      discard();
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        message: tooBig ? `A file is larger than the ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit` : `Upload failed: ${err.message}`,
      });
    }
    if (!files.length) return res.status(400).json({ message: 'No files received' });
    const isVoice = req.body?.voice === '1';
    const insert = db.prepare(`
      INSERT INTO task_attachments (task_id, user_id, original_name, stored_name, mime_type, size, is_voice, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const names = files.map((f) => {
      const name = decodeName(f.originalname).slice(0, 255) || 'file';
      insert.run(req.task.id, req.user.id, name, f.filename, f.mimetype || 'application/octet-stream', f.size,
        isVoice ? 1 : 0, new Date().toISOString());
      return name;
    });
    const what = isVoice ? 'a voice note' : names.length === 1 ? `"${names[0]}"` : `${names.length} files`;
    logActivity(req.task.id, req.user.id, `attached ${what}`);
    notify([req.task.developer_id, ...adminIds(), ...clientUserIds(req.task.client_id)], {
      taskId: req.task.id, actorId: req.user.id, type: 'attachment',
      message: `${req.user.name} attached ${what} to "${req.task.title}"`,
    });
    res.status(201).json(listAttachments(req.task.id));
  });
});

// Soft delete (restorable from Trash): the uploader or an admin
taskDetailsRouter.delete('/attachments/:attachmentId', (req, res) => {
  const file = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND task_id = ? AND deleted_at IS NULL')
    .get(req.params.attachmentId, req.task.id);
  if (!file) return res.status(404).json({ message: 'File not found' });
  if (file.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only the person who uploaded it or an admin can delete this file' });
  }
  db.prepare('UPDATE task_attachments SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), file.id);
  logActivity(req.task.id, req.user.id, `deleted ${file.is_voice ? 'a voice note' : `file "${file.original_name}"`}`);
  res.json(listAttachments(req.task.id));
});

// Make sure the stored file path can never escape the upload folder
export const storedPath = (storedName) => {
  const p = path.join(uploadDir, path.basename(storedName));
  return p.startsWith(uploadDir) ? p : null;
};
