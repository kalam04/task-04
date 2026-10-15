import { Router } from 'express';
import { db } from '../db.js';

// Personal dashboard for the signed-in user (built for developers; works for anyone)
export const dashboardRouter = Router();

const DAY = 86400;

// Seconds of the user's time slots inside [from, to); running slots count up to now
const secondsBetween = db.prepare(`
  SELECT COALESCE(SUM(MAX(0, MIN(COALESCE(unixepoch(e.ended_at), unixepoch('now')), :to) - MAX(unixepoch(e.started_at), :from))), 0) AS s
  FROM time_entries e JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
  WHERE e.user_id = :user AND unixepoch(e.started_at) < :to AND COALESCE(unixepoch(e.ended_at), unixepoch('now')) > :from`);

// ?today=<ISO start of the viewer's local day>&week=<ISO start of their local week (Monday)>
dashboardRouter.get('/me', (req, res) => {
  const today = Math.floor(new Date(req.query.today).getTime() / 1000);
  const week = Math.floor(new Date(req.query.week).getTime() / 1000);
  if (!Number.isFinite(today) || !Number.isFinite(week)) {
    return res.status(400).json({ message: 'today and week (ISO timestamps) are required' });
  }
  const user = req.user.id;

  const days = Array.from({ length: 7 }, (_, i) => {
    const from = week + i * DAY;
    return { start: new Date(from * 1000).toISOString(), seconds: secondsBetween.get({ user, from, to: from + DAY }).s };
  });

  const byProject = db.prepare(`
    SELECT p.id, p.name,
      SUM(MAX(0, MIN(COALESCE(unixepoch(e.ended_at), unixepoch('now')), :to) - MAX(unixepoch(e.started_at), :from))) AS seconds
    FROM time_entries e
    JOIN tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    JOIN projects p ON p.id = t.project_id
    WHERE e.user_id = :user AND unixepoch(e.started_at) < :to AND COALESCE(unixepoch(e.ended_at), unixepoch('now')) > :from
    GROUP BY p.id HAVING seconds > 0 ORDER BY seconds DESC`).all({ user, from: week, to: week + 7 * DAY });

  const completedThisWeek = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE developer_id = ? AND deleted_at IS NULL AND completed_at IS NOT NULL AND unixepoch(completed_at) >= ?`).get(user, week).n;

  // Latest comments other people left on my tasks
  const recentComments = db.prepare(`
    SELECT c.id, c.body, c.created_at, u.name AS user_name, t.id AS task_id, t.title AS task_title
    FROM task_comments c
    JOIN tasks t ON t.id = c.task_id AND t.deleted_at IS NULL
    LEFT JOIN users u ON u.id = c.user_id
    WHERE t.developer_id = ? AND c.user_id != ? AND c.deleted_at IS NULL
    ORDER BY c.created_at DESC LIMIT 6`).all(user, user);

  const unassigned = db.prepare(`
    SELECT COUNT(*) AS n FROM tasks
    WHERE deleted_at IS NULL AND developer_id IS NULL AND status IN ('pending','in_progress')`).get().n;

  res.json({
    todaySeconds: secondsBetween.get({ user, from: today, to: today + DAY }).s,
    weekSeconds: days.reduce((sum, d) => sum + d.seconds, 0),
    days, byProject, completedThisWeek, recentComments, unassigned,
  });
});
