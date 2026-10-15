// Where attachment files live, and how big one may be.
//   UPLOAD_DIR     default: an "uploads" folder next to the database
//   MAX_UPLOAD_MB  default: 2048 (2 GB per file)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { dbPath } from './db.js';

export const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(path.dirname(dbPath), 'uploads'));
export const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024;
fs.mkdirSync(uploadDir, { recursive: true });

// Files are streamed straight to disk under a random name; the original name is kept in the database
export const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: maxUploadBytes, files: 20 },
});

// Browser-safe types that may be shown inline (images, audio, video, PDF). Everything else
// (HTML, SVG, scripts, ...) is always sent as a download so it can't run in the app's origin.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|bmp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;
export const canShowInline = (mime) => INLINE_TYPES.test(mime || '');

// multer decodes names as latin1; browsers send UTF-8 (e.g. Bangla file names)
export const decodeName = (name) => Buffer.from(name, 'latin1').toString('utf8');
