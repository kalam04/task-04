// Database backups: a consistent copy via SQLite's VACUUM INTO, keeping the newest BACKUP_KEEP files.
//   npm run backup    make one now
// The server also makes one automatically once a day (see startAutoBackup).
import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath } from './db.js';

const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(dbPath), 'backups'));
const keep = Number(process.env.BACKUP_KEEP || 14);
const DAY = 24 * 3600_000;

const listBackups = () => (fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [])
  .filter((f) => /^tasks-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db$/.test(f))
  .sort();

export function backupNow() {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const file = path.join(backupDir, `tasks-${stamp}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const old of listBackups().slice(0, -keep)) fs.unlinkSync(path.join(backupDir, old));
  return file;
}

function lastBackupAge() {
  const latest = listBackups().at(-1);
  return latest ? Date.now() - fs.statSync(path.join(backupDir, latest)).mtimeMs : Infinity;
}

export function startAutoBackup() {
  if (process.env.BACKUP_DISABLED === 'true') return;
  const check = () => {
    try {
      if (lastBackupAge() >= DAY) console.log(`Database backup written: ${backupNow()}`);
    } catch (err) {
      console.error('Database backup failed:', err.message);
    }
  };
  check();
  setInterval(check, 3600_000).unref();
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(`Backup written: ${backupNow()}`);
