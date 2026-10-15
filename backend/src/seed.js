import bcrypt from 'bcryptjs';
import { db } from './db.js';

export function seedDefaultUser() {
  const { DEFAULT_USERNAME: username, DEFAULT_PASSWORD: password } = process.env;
  if (!username || !password) return;
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    db.prepare(`UPDATE users SET role = 'admin', name = COALESCE(name, 'Administrator') WHERE id = ?`).run(exists.id);
    return;
  }
  db.prepare(`INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'admin', 'Administrator')`)
    .run(username, bcrypt.hashSync(password, 10));
  console.log(`Seeded default user "${username}"`);
}

if (import.meta.url === `file://${process.argv[1]}`) seedDefaultUser();
