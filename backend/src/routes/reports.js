import { Router } from 'express';
import { db } from '../db.js';

export const reportsRouter = Router();

// Queries share one parameter object, so allow parameters a particular query doesn't use
function prep(sql) {
  const stmt = db.prepare(sql);
  stmt.setAllowUnknownNamedParameters(true);
  return stmt;
}

// Estimates in days are converted at this many working hours per day
export const HOURS_PER_DAY = 8;

// Reads ?from=&to= (ISO timestamps from the browser, so ranges follow the viewer's time zone)
function readRange(req, res) {
  const from = new Date(req.query.from);
  const to = new Date(req.query.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    res.status(400).json({ message: 'A valid from/to range is required' });
    return null;
  }
  return { from: Math.floor(from.getTime() / 1000), to: Math.floor(to.getTime() / 1000) };
}

// Seconds of a time slot that fall inside [from, to]; running slots count up to now
const CLIPPED_SECONDS = `MAX(0, MIN(COALESCE(unixepoch(e.ended_at), unixepoch('now')), :to) - MAX(unixepoch(e.started_at), :from))`;

function extraFilters(query) {
  const where = [];
  const params = {};
  if (query.project_id) { where.push('t.project_id = :project_id'); params.project_id = Number(query.project_id); }
  if (query.developer_id) { where.push('e.user_id = :developer_id'); params.developer_id = Number(query.developer_id); }
  return { sql: where.length ? `AND ${where.join(' AND ')}` : '', params };
}

// FROM/WHERE for time slots overlapping the range, with optional extra joins
function slotsInRange(filters, joins = '') {
  return `
    FROM time_entries e
    JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    ${joins}
    WHERE unixepoch(e.started_at) < :to AND COALESCE(unixepoch(e.ended_at), unixepoch('now')) > :from ${filters.sql}`;
}

reportsRouter.get('/summary', (req, res) => {
  const range = readRange(req, res);
  if (!range) return;
  const f = extraFilters(req.query);
  const p = { ...range, ...f.params };

  const byDeveloper = prep(`
    SELECT u.id, u.name, SUM(${CLIPPED_SECONDS}) AS seconds, COUNT(DISTINCT e.task_id) AS tasks_worked
    ${slotsInRange(f, 'LEFT JOIN users u ON u.id = e.user_id')}
    GROUP BY e.user_id ORDER BY seconds DESC`).all(p);

  const byProject = prep(`
    SELECT pr.id, pr.name, SUM(${CLIPPED_SECONDS}) AS seconds, COUNT(DISTINCT e.task_id) AS tasks_worked
    ${slotsInRange(f, 'JOIN projects pr ON pr.id = t.project_id')}
    GROUP BY t.project_id ORDER BY seconds DESC`).all(p);

  const byClient = prep(`
    SELECT c.id, COALESCE(c.name, '(No client)') AS name, pr.name AS project_name,
      SUM(${CLIPPED_SECONDS}) AS seconds, COUNT(DISTINCT e.task_id) AS tasks_worked
    ${slotsInRange(f, 'JOIN projects pr ON pr.id = t.project_id LEFT JOIN clients c ON c.id = t.client_id')}
    GROUP BY t.project_id, t.client_id ORDER BY seconds DESC`).all(p);

  // Estimate vs actual for tasks that had work in the range or were completed in it
  const taskFilter = [];
  if (req.query.project_id) taskFilter.push('t.project_id = :project_id');
  if (req.query.developer_id) taskFilter.push('t.developer_id = :developer_id');
  const taskWhere = `t.deleted_at IS NULL ${taskFilter.length ? `AND ${taskFilter.join(' AND ')}` : ''}`;

  const estimates = prep(`
    SELECT t.id, t.title, t.status, t.estimate_value, t.estimate_unit, pr.name AS project_name, u.name AS developer_name,
      t.estimate_value * CASE t.estimate_unit WHEN 'days' THEN ${HOURS_PER_DAY} ELSE 1 END * 3600 AS estimate_seconds,
      (SELECT COALESCE(SUM(COALESCE(unixepoch(e.ended_at), unixepoch('now')) - unixepoch(e.started_at)), 0)
        FROM time_entries e WHERE e.task_id = t.id) AS actual_seconds
    FROM tasks t JOIN projects pr ON pr.id = t.project_id LEFT JOIN users u ON u.id = t.developer_id
    WHERE ${taskWhere} AND t.estimate_value IS NOT NULL
      AND (EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = t.id
            AND unixepoch(e.started_at) < :to AND COALESCE(unixepoch(e.ended_at), unixepoch('now')) > :from)
        OR (t.completed_at IS NOT NULL AND unixepoch(t.completed_at) BETWEEN :from AND :to))
    ORDER BY actual_seconds - estimate_seconds DESC`).all(p);

  const open = `t.status IN ('pending','in_progress')`;
  const overdue = `${open} AND t.due_date IS NOT NULL AND t.due_date < date('now', 'localtime')`;
  const totals = prep(`
    SELECT
      (SELECT COALESCE(SUM(${CLIPPED_SECONDS}), 0) ${slotsInRange(f)}) AS seconds,
      (SELECT COUNT(*) FROM tasks t WHERE ${taskWhere} AND t.completed_at IS NOT NULL
        AND unixepoch(t.completed_at) BETWEEN :from AND :to) AS completed,
      (SELECT COUNT(*) FROM tasks t WHERE ${taskWhere} AND ${open}) AS open,
      (SELECT COUNT(*) FROM tasks t WHERE ${taskWhere} AND ${overdue}) AS overdue,
      (SELECT COUNT(*) FROM tasks t WHERE t.deleted_at IS NULL AND t.developer_id IS NULL AND ${open}
        ${req.query.project_id ? 'AND t.project_id = :project_id' : ''}) AS unassigned`).get(p);

  // Current workload per developer (not limited to the date range)
  const workload = prep(`
    SELECT u.id, u.name,
      COALESCE(SUM(t.status = 'pending'), 0) AS pending,
      COALESCE(SUM(t.status = 'in_progress'), 0) AS in_progress,
      COALESCE(SUM(${overdue}), 0) AS overdue
    FROM users u LEFT JOIN tasks t ON t.developer_id = u.id AND t.deleted_at IS NULL
      ${req.query.project_id ? 'AND t.project_id = :project_id' : ''}
    WHERE u.role = 'developer' AND u.deleted_at IS NULL ${req.query.developer_id ? 'AND u.id = :developer_id' : ''}
    GROUP BY u.id ORDER BY in_progress + pending DESC, u.name`).all(p);

  res.json({ totals, byDeveloper, byProject, byClient, estimates, workload, hoursPerDay: HOURS_PER_DAY });
});

// Every time slot overlapping the range — for the Excel export
reportsRouter.get('/timesheet', (req, res) => {
  const range = readRange(req, res);
  if (!range) return;
  const f = extraFilters(req.query);
  res.json(prep(`
    SELECT e.id, e.started_at, e.ended_at, e.note, ${CLIPPED_SECONDS} AS seconds_in_range,
      t.id AS task_id, t.title AS task_title, t.status, pr.name AS project_name, c.name AS client_name, u.name AS developer_name
    FROM time_entries e
    JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    JOIN projects pr ON pr.id = t.project_id
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE unixepoch(e.started_at) < :to AND COALESCE(unixepoch(e.ended_at), unixepoch('now')) > :from ${f.sql}
    ORDER BY e.started_at`).all({ ...range, ...f.params }));
});
