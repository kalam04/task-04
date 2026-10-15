import fs from 'node:fs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { canShowInline } from '../uploads.js';
import { storedPath } from './taskDetails.js';

// GET /api/files/:id?token=...[&inline=1]
// Links are signed and short-lived (made by the attachments list), so <img>, <audio> and
// download links work without the login header.
export const filesRouter = Router();

filesRouter.get('/:id', (req, res) => {
  let claims;
  try {
    claims = jwt.verify(String(req.query.token ?? ''), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'This file link has expired. Reopen the task to get a fresh link.' });
  }
  if (claims.typ !== 'file' || claims.aid !== Number(req.params.id)) return res.status(403).json({ message: 'Invalid file link' });

  const file = db.prepare(`
    SELECT a.* FROM task_attachments a JOIN tasks t ON t.id = a.task_id
    WHERE a.id = ? AND a.deleted_at IS NULL AND t.deleted_at IS NULL`).get(claims.aid);
  const filePath = file && storedPath(file.stored_name);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'File not found' });

  const inline = req.query.inline === '1' && canShowInline(file.mime_type);
  res.attachment(file.original_name); // safe Content-Disposition incl. non-English names
  if (inline) res.setHeader('Content-Disposition', res.getHeader('Content-Disposition').replace(/^attachment/, 'inline'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // sendFile streams and supports range requests, so large videos/audio can be seeked
  res.sendFile(filePath, { headers: { 'Content-Type': inline ? file.mime_type : (file.mime_type || 'application/octet-stream') } });
});
