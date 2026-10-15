import { Router } from 'express';
import { db } from '../db.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', (req, res) => {
  const items = db.prepare(`
    SELECT n.id, n.task_id, n.type, n.message, n.is_read, n.created_at,
      t.deleted_at IS NOT NULL AS task_deleted
    FROM notifications n LEFT JOIN tasks t ON t.id = n.task_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC, n.id DESC LIMIT 50`
  ).all(req.user.id);
  const { unread } = db.prepare('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id);
  res.json({ unread, items });
});

notificationsRouter.post('/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  res.status(204).end();
});

notificationsRouter.post('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.status(204).end();
});
