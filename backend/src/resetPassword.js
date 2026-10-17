// Set a new password for any account from the server's command line (e.g. a forgotten admin password).
//   npm run reset-password -- <username>            generates a random password and prints it
//   npm run reset-password -- <username> <password> uses the password you give (min 8 characters)
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, dbPath } from './db.js';

const [username, given] = process.argv.slice(2);
if (!username) {
  const users = db.prepare('SELECT username, role FROM users WHERE deleted_at IS NULL ORDER BY role, username').all();
  console.log('Usage: npm run reset-password -- <username> [new-password]\n\nAccounts in', dbPath);
  for (const u of users) console.log(`  ${u.username.padEnd(20)} ${u.role}`);
  process.exit(users.length ? 1 : 2);
}
const user = db.prepare('SELECT id, username, role, deleted_at FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`No account named "${username}". Run without arguments to list accounts.`);
  process.exit(1);
}
if (given && given.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
const password = given || crypto.randomBytes(9).toString('base64url');
db.prepare('UPDATE users SET password_hash = ?, deleted_at = NULL WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
console.log(`Password for "${user.username}" (${user.role}) has been reset${user.deleted_at ? ' and the account restored from Trash' : ''}.`);
if (!given) console.log(`New password: ${password}\nSign in and change it from your name menu → Change password.`);
