import { Router } from 'express';
import { db, transaction } from '../db.js';
import { requireAdmin } from '../auth.js';
import { taskDetailsRouter } from './taskDetails.js';
import { startTimer, stopTimer } from './timer.js';
import { PRIORITY_LABELS, STATUS_LABELS, adminIds, logActivity, notify } from '../activity.js';
import { cancelPendingRequests, createRequest } from './requests.js';
import { canSeeTask, clientProjectIds, clientScope, clientUserIds, isClientUser } from '../access.js';

export const tasksRouter = Router();

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'in_progress', 'completed', 'rejected'];

const selectTask = `
  SELECT t.*, p.name AS project_name, c.name AS client_name,
    d.name AS developer_name, d.username AS developer_username,
    c.deleted_at IS NOT NULL AS client_deleted, d.deleted_at IS NOT NULL AS developer_deleted,
    (SELECT COALESCE(SUM(unixepoch(e.ended_at) - unixepoch(e.started_at)), 0)
      FROM time_entries e WHERE e.task_id = t.id AND e.ended_at IS NOT NULL) AS logged_seconds,
    (SELECT e.started_at FROM time_entries e WHERE e.task_id = t.id AND e.ended_at IS NULL) AS running_since,
    (SELECT COUNT(*) FROM time_entries e WHERE e.task_id = t.id) AS time_entry_count,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.deleted_at IS NULL) AS subtask_total,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.deleted_at IS NULL AND s.is_done = 1) AS subtask_done,
    (SELECT COUNT(*) FROM task_comments m WHERE m.task_id = t.id AND m.deleted_at IS NULL) AS comment_count,
    (SELECT COUNT(*) FROM task_attachments f WHERE f.task_id = t.id AND f.deleted_at IS NULL) AS attachment_count,
    cb.name AS created_by_name, cb.role AS created_by_role,
    r.id AS request_id, r.developer_id AS request_developer_id, rd.name AS request_developer_name,
    r.requested_by AS request_by_id, rb.name AS request_by_name, r.message AS request_message, r.created_at AS request_created_at
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN users d ON d.id = t.developer_id
  LEFT JOIN users cb ON cb.id = t.created_by
  LEFT JOIN assignment_requests r ON r.task_id = t.id AND r.status = 'pending'
  LEFT JOIN users rd ON rd.id = r.developer_id
  LEFT JOIN users rb ON rb.id = r.requested_by`;

export const getTask = (id) => db.prepare(`${selectTask} WHERE t.id = ? AND t.deleted_at IS NULL`).get(id);

// `current` is the task being edited: it may keep a client/developer that has since been deleted.
function validateTask(body, current) {
  const { title, project_id, client_id, developer_id, priority } = body ?? {};
  if (!title?.trim()) return 'Title is required';
  if (!db.prepare('SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL').get(project_id)) return 'Valid project is required';
  const keepingClient = current && current.client_id === Number(client_id) && current.project_id === Number(project_id);
  const client = client_id && db.prepare(`SELECT c.deleted_at FROM clients c
    JOIN project_clients pc ON pc.client_id = c.id AND pc.project_id = ? WHERE c.id = ?`).get(project_id, client_id);
  if (client_id && !keepingClient && (!client || client.deleted_at)) {
    return 'Client does not belong to the selected project';
  }
  const dev = developer_id && db.prepare(`SELECT deleted_at FROM users WHERE id = ? AND role = 'developer'`).get(developer_id);
  if (developer_id && (!dev || (dev.deleted_at && current?.developer_id !== Number(developer_id)))) {
    return 'Invalid developer';
  }
  if (priority && !PRIORITIES.includes(priority)) return 'Invalid priority';
  return null;
}

// Everyone can see every task; only the assigned developer (or an admin) can change one.
export const canEditTask = (user, task) => user.role === 'admin' || task.developer_id === user.id;

// Marketing and Support: see and create tasks, edit any task's details, request developers
export const STAFF_ROLES = ['marketing', 'support'];
export const isStaff = (user) => STAFF_ROLES.includes(user.role);
// Task details (title, description, project, client, priority, due date)
const canEditDetails = (user, task) => canEditTask(user, task) || isStaff(user);

function forbidden(res) {
  return res.status(403).json({ message: 'Only the assigned developer or an admin can change this task' });
}

// WHERE clause shared by the list and the stats (stats ignore the status filter)
function buildFilters(query, { withStatus = true, user } = {}) {
  const where = ['t.deleted_at IS NULL'];
  const params = [];
  const scope = clientScope(user);
  if (scope.sql) {
    where.push(scope.sql);
    params.push(...scope.params);
  }
  if (query.created_by) {
    where.push('t.created_by = ?');
    params.push(query.created_by);
  }
  if (query.developer_id === 'none') where.push('t.developer_id IS NULL');
  else if (query.developer_id) {
    where.push('t.developer_id = ?');
    params.push(query.developer_id);
  }
  // "open" = everything still to be finished
  if (withStatus && query.status === 'open') where.push(`t.status IN ('pending','in_progress')`);
  else if (withStatus && query.status && query.status !== 'all') {
    where.push('t.status = ?');
    params.push(query.status);
  }
  for (const key of ['project_id', 'client_id', 'priority']) {
    if (query[key]) {
      where.push(`t.${key} = ?`);
      params.push(query[key]);
    }
  }
  if (query.q) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.provided_by LIKE ?)');
    params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
  }
  return { where, params };
}

tasksRouter.get('/', (req, res) => {
  const { where, params } = buildFilters(req.query, { user: req.user });
  const sql = `${selectTask} WHERE ${where.join(' AND ')}
    ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
      t.due_date IS NULL, t.due_date,
      t.created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

tasksRouter.get('/stats', (req, res) => {
  const { where, params } = buildFilters(req.query, { withStatus: false, user: req.user });
  const rows = db.prepare(`SELECT t.status, COUNT(*) AS count FROM tasks t WHERE ${where.join(' AND ')} GROUP BY t.status`)
    .all(...params);
  const stats = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) stats[r.status] = r.count;
  res.json(stats);
});

// Names already used in "Task provided by", for suggestions in the form
tasksRouter.get('/provided-by-names', (req, res) => {
  if (isClientUser(req.user)) return res.json([]);
  res.json(db.prepare(`
    SELECT provided_by AS name, COUNT(*) AS n FROM tasks
    WHERE provided_by IS NOT NULL AND deleted_at IS NULL
    GROUP BY provided_by ORDER BY n DESC, provided_by LIMIT 200`).all().map((r) => r.name));
});

const cleanProvidedBy = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 200) || null : null);

tasksRouter.get('/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!canSeeTask(req.user, task)) return res.status(404).json({ message: 'Task not found' });
  res.json(task);
});

// Admins and developers can create tasks; a developer's new task defaults to themselves in the UI
tasksRouter.post('/', (req, res) => {
  if (isClientUser(req.user)) {
    if (!clientProjectIds(req.user.client_id).includes(Number(req.body?.project_id))) {
      return res.status(400).json({ message: 'Choose one of your projects' });
    }
    req.body = {
      ...req.body, client_id: req.user.client_id, developer_id: null, request_developer_id: null,
      provided_by: req.body?.provided_by?.trim() || req.user.name,
    };
  }
  const error = validateTask(req.body);
  if (error) return res.status(400).json({ message: error });
  const { title, description, project_id, client_id, priority, due_date } = req.body;
  // Marketing/Support don't assign; they can request a developer instead (below)
  const developer_id = isStaff(req.user) || isClientUser(req.user) ? null : req.body.developer_id;
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO tasks (title, description, project_id, client_id, developer_id, priority, due_date, provided_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(title.trim(), description || null, project_id, client_id || null, developer_id || null,
    priority || 'medium', due_date || null, cleanProvidedBy(req.body.provided_by), req.user.id);
  const task = getTask(lastInsertRowid);
  logActivity(task.id, req.user.id, 'created the task');
  if (req.user.role !== 'admin') {
    notify(adminIds(), {
      taskId: task.id, actorId: req.user.id, type: 'created',
      message: `${req.user.name} created "${task.title}"${task.developer_name ? ` for ${task.developer_name}` : ' (unassigned)'}`,
    });
  }
  if (task.developer_id) {
    logActivity(task.id, req.user.id, `assigned it to ${task.developer_name}`);
    notify([task.developer_id], {
      taskId: task.id, actorId: req.user.id, type: 'assigned',
      message: `${req.user.name} assigned you "${task.title}"`,
    });
  }
  if (req.body.request_developer_id && !task.developer_id) {
    const result = createRequest(req.user, task, req.body.request_developer_id, req.body.request_message);
    if (result.error) return res.status(201).json({ ...getTask(task.id), request_error: result.error });
  }
  res.status(201).json(getTask(task.id));
});

// Admins edit any task; the assigned developer edits their own open task but can't reassign it
tasksRouter.put('/:id', (req, res) => {
  const current = getTask(req.params.id);
  if (!current) return res.status(404).json({ message: 'Task not found' });
  const isDev = req.user.role === 'developer';
  if (!canEditDetails(req.user, current)) return forbidden(res);
  if (isDev && ['completed', 'rejected'].includes(current.status)) {
    return res.status(403).json({ message: 'This task is closed; ask an admin to reopen it' });
  }
  // Only admins (re)assign from the edit form
  const body = req.user.role === 'admin' ? req.body : { ...req.body, developer_id: current.developer_id };
  const error = validateTask(body, current);
  if (error) return res.status(400).json({ message: error });
  const { title, description, project_id, client_id, developer_id, priority, due_date } = body;
  const { changes } = db.prepare(`
    UPDATE tasks SET title = ?, description = ?, project_id = ?, client_id = ?, developer_id = ?,
      priority = ?, due_date = ?, provided_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL`
  ).run(title.trim(), description || null, project_id, client_id || null, developer_id || null,
    priority || 'medium', due_date || null,
    body.provided_by === undefined ? current.provided_by : cleanProvidedBy(body.provided_by), req.params.id);
  if (!changes) return res.status(404).json({ message: 'Task not found' });
  const task = getTask(req.params.id);
  const diffs = [];
  if (task.title !== current.title) diffs.push(`renamed it from "${current.title}" to "${task.title}"`);
  if ((task.description ?? '') !== (current.description ?? '')) diffs.push('updated the description');
  if (task.project_id !== current.project_id) diffs.push(`moved it from project ${current.project_name} to ${task.project_name}`);
  if (task.client_id !== current.client_id) diffs.push(`changed client from ${current.client_name ?? 'none'} to ${task.client_name ?? 'none'}`);
  if (task.priority !== current.priority) {
    diffs.push(`changed priority from ${PRIORITY_LABELS[current.priority]} to ${PRIORITY_LABELS[task.priority]}`);
  }
  if ((task.due_date ?? '') !== (current.due_date ?? '')) diffs.push(`changed due date from ${current.due_date ?? 'none'} to ${task.due_date ?? 'none'}`);
  if ((task.provided_by ?? '') !== (current.provided_by ?? '')) {
    diffs.push(task.provided_by ? `set "provided by" to ${task.provided_by}` : 'cleared "provided by"');
  }
  for (const d of diffs) logActivity(task.id, req.user.id, d);
  if (task.developer_id !== current.developer_id) recordAssignment(req, current, task);
  res.json(getTask(task.id));
});

function recordAssignment(req, before, task) {
  if (task.developer_id) cancelPendingRequests(task.id, req.user.id, `assigned directly to ${task.developer_name}`);
  logActivity(task.id, req.user.id, task.developer_id
    ? `${before.developer_id ? 'reassigned' : 'assigned'} it to ${task.developer_name}`
    : `unassigned ${before.developer_name ?? 'the developer'}`);
  if (task.developer_id) {
    notify([task.developer_id], {
      taskId: task.id, actorId: req.user.id, type: 'assigned',
      message: `${req.user.name} assigned you "${task.title}"`,
    });
  }
}

// Status changes: developers can start, complete or reject their own tasks; admins can set any status.
tasksRouter.patch('/:id/status', (req, res) => {
  const { status, reject_reason } = req.body ?? {};
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim().slice(0, 5000) || null : null;
  const task = getTask(req.params.id);
  const isDev = req.user.role === 'developer';
  if (!task) return res.status(404).json({ message: 'Task not found' });
  if (!canEditTask(req.user, task)) return forbidden(res);
  if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  if (isDev && status === 'pending') return res.status(403).json({ message: 'Only an admin can reopen a task' });
  if (isDev && ['completed', 'rejected'].includes(task.status)) {
    return res.status(403).json({ message: 'This task is closed; ask an admin to reopen it' });
  }
  if (status === 'rejected' && !reject_reason?.trim()) {
    return res.status(400).json({ message: 'A reason is required to reject a task' });
  }
  transaction(() => {
    db.prepare(`
      UPDATE tasks SET status = ?, reject_reason = ?,
        completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
        completion_remarks = CASE WHEN ? = 'completed' THEN ? ELSE completion_remarks END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
    ).run(status, status === 'rejected' ? reject_reason.trim() : null, status, status, remarks, task.id);
    // Starting work opens a time slot; finishing (or rejecting) closes the running one
    if (status === 'in_progress' && task.status === 'pending' && !task.running_since) startTimer(task.id, req.user.id);
    if (['completed', 'rejected', 'pending'].includes(status)) stopTimer(task.id);
  });
  if (status !== task.status) {
    logActivity(task.id, req.user.id, status === 'rejected'
      ? `rejected the task: "${reject_reason.trim()}"`
      : `changed status from ${STATUS_LABELS[task.status]} to ${STATUS_LABELS[status]}${status === 'completed' && remarks ? ` with remarks: "${remarks}"` : ''}`);
    // Developers finishing or rejecting tells the admins; an admin changing status tells the assignee
    if (isDev && ['completed', 'rejected'].includes(status)) {
      notify(adminIds(), {
        taskId: task.id, actorId: req.user.id, type: status,
        message: status === 'rejected'
          ? `${req.user.name} rejected "${task.title}": ${reject_reason.trim()}`
          : `${req.user.name} completed "${task.title}"${remarks ? `: ${remarks.length > 80 ? `${remarks.slice(0, 80)}…` : remarks}` : ''}`,
      });
    }
    if (['in_progress', 'completed', 'rejected'].includes(status)) {
      notify(clientUserIds(task.client_id), {
        taskId: task.id, actorId: req.user.id, type: status === 'in_progress' ? 'status' : status,
        message: `"${task.title}" is now ${STATUS_LABELS[status]}`,
      });
    }
    if (!isDev) {
      notify([task.developer_id], {
        taskId: task.id, actorId: req.user.id, type: 'status',
        message: `${req.user.name} changed "${task.title}" to ${STATUS_LABELS[status]}`,
      });
    }
  }
  res.json(getTask(task.id));
});

// Completion remarks: the assignee (or an admin) can add or change them once the task is completed
tasksRouter.patch('/:id/remarks', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task not found' });
  if (!canEditTask(req.user, task)) return forbidden(res);
  if (task.status !== 'completed') return res.status(400).json({ message: 'Remarks can be added once the task is completed' });
  const remarks = typeof req.body?.remarks === 'string' ? req.body.remarks.trim().slice(0, 5000) || null : null;
  if ((remarks ?? '') === (task.completion_remarks ?? '')) return res.json(task);
  db.prepare('UPDATE tasks SET completion_remarks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(remarks, task.id);
  logActivity(task.id, req.user.id, remarks ? `updated the completion remarks: "${remarks}"` : 'removed the completion remarks');
  if (req.user.role === 'developer' && remarks) {
    notify(adminIds(), {
      taskId: task.id, actorId: req.user.id, type: 'completed',
      message: `${req.user.name} added remarks to "${task.title}": ${remarks.length > 80 ? `${remarks.slice(0, 80)}…` : remarks}`,
    });
  }
  res.json(getTask(task.id));
});

// Time estimate: the assigned developer (or an admin) sets how many hours/days the task needs.
tasksRouter.patch('/:id/estimate', (req, res) => {
  const { estimate_value, estimate_unit } = req.body ?? {};
  const task = getTask(req.params.id);
  const isDev = req.user.role === 'developer';
  if (!task) return res.status(404).json({ message: 'Task not found' });
  if (!canEditTask(req.user, task)) return forbidden(res);
  if (isDev && ['completed', 'rejected'].includes(task.status)) {
    return res.status(403).json({ message: 'This task is closed; the estimate can no longer be changed' });
  }
  const clearing = estimate_value === null || estimate_value === '';
  const value = Number(estimate_value);
  if (!clearing) {
    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ message: 'Estimate must be a positive number' });
    if (!['hours', 'days'].includes(estimate_unit)) return res.status(400).json({ message: 'Unit must be hours or days' });
  }
  db.prepare(`
    UPDATE tasks SET estimate_value = ?, estimate_unit = ?,
      estimate_set_at = CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`
  ).run(clearing ? null : value, clearing ? null : estimate_unit, clearing ? null : value, task.id);
  logActivity(task.id, req.user.id, clearing ? 'cleared the estimate' : `set the estimate to ${value} ${estimate_unit}`);
  res.json(getTask(task.id));
});

// Quick priority change from the task list: admins, or the assigned developer while the task is open
tasksRouter.patch('/:id/priority', (req, res) => {
  const task = getTask(req.params.id);
  const isDev = req.user.role === 'developer';
  if (!task) return res.status(404).json({ message: 'Task not found' });
  if (!canEditDetails(req.user, task)) return forbidden(res);
  if (isDev && ['completed', 'rejected'].includes(task.status)) {
    return res.status(403).json({ message: 'This task is closed; the priority can no longer be changed' });
  }
  const { priority } = req.body ?? {};
  if (!PRIORITIES.includes(priority)) return res.status(400).json({ message: 'Invalid priority' });
  if (priority !== task.priority) {
    db.prepare('UPDATE tasks SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(priority, task.id);
    logActivity(task.id, req.user.id, `changed priority from ${PRIORITY_LABELS[task.priority]} to ${PRIORITY_LABELS[priority]}`);
    // Tell the admins and the assignee (whoever changed it is skipped)
    notify([...adminIds(), task.developer_id], {
      taskId: task.id, actorId: req.user.id, type: 'status',
      message: `${req.user.name} changed the priority of "${task.title}" to ${PRIORITY_LABELS[priority]}`,
    });
  }
  res.json(getTask(task.id));
});

// Assign: admins can (re)assign any task; a developer can assign an unassigned task to anyone (incl. themselves)
tasksRouter.patch('/:id/assign', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task not found' });
  const developerId = req.body?.developer_id || null;
  if (isStaff(req.user)) return res.status(403).json({ message: 'Request a developer instead; they can accept or decline' });
  if (isClientUser(req.user)) return res.status(403).json({ message: 'Not allowed for client users' });
  if (req.user.role !== 'admin') {
    if (task.developer_id) return res.status(403).json({ message: 'This task is already assigned; only an admin can reassign it' });
    if (!developerId) return res.status(400).json({ message: 'Choose a developer' });
  }
  if (developerId && !db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'developer' AND deleted_at IS NULL`).get(developerId)) {
    return res.status(400).json({ message: 'Invalid developer' });
  }
  // A guarded update so two developers can't grab the same unassigned task at once
  const { changes } = db.prepare(`
    UPDATE tasks SET developer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND (? = 'admin' OR developer_id IS NULL)`
  ).run(developerId, task.id, req.user.role);
  if (!changes) return res.status(409).json({ message: 'Someone else just assigned this task' });
  const updated = getTask(task.id);
  if (updated.developer_id !== task.developer_id) recordAssignment(req, task, updated);
  res.json(getTask(task.id));
});

// Subtasks and time log live under /tasks/:taskId/...
tasksRouter.use('/:taskId', taskDetailsRouter);

tasksRouter.delete('/:id', requireAdmin, (req, res) => {
  const { changes } = db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(new Date().toISOString(), req.params.id);
  if (!changes) return res.status(404).json({ message: 'Task not found' });
  logActivity(Number(req.params.id), req.user.id, 'moved the task to Trash');
  res.status(204).end();
});
