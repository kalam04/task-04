# Task Management — notes for Claude

Task management app for Yetfix: React (Vite + MUI) frontend in `frontend/`, Node.js (Express + built-in
`node:sqlite`) backend in `backend/`. In production the backend also serves the built frontend on one port.
Roles: admin, developer, marketing, support, client. See `README.md` for features and `DEPLOY.md` for the server setup.

## Is this the live server?

If the project lives at `/opt/task-management` and `backend/.env` contains `NODE_ENV=production`, you are on the
**live server** (https://task.yetfix.com). Real users depend on it — be careful.

Live server facts:
- Code: `/opt/task-management` (a clone of https://github.com/kalam04/task-04, branch `main`)
- Settings: `backend/.env` — **never print, change or commit it** (it holds secrets)
- Data: database and uploaded files in `/var/lib/task-management` (`DB_PATH`, `UPLOAD_DIR`) — **never delete, move or edit**
- Backups: `/var/backups/task-management` (daily, automatic)
- Process: PM2 app `task-management` (port 4000); Apache reverse proxy + Certbot HTTPS in front

## Updating the live server from GitHub

When asked to update / deploy / pull the latest version, run:

```bash
cd /opt/task-management && npm run deploy
```

`scripts/deploy.sh` backs up the database, `git stash`es any edits made directly on the server (they are kept in
`git stash list`), pulls `main` (fast-forward only), installs, builds, restarts PM2 and checks `/api/health`.
Report what changed (the commit list it prints) and whether the health check passed.

If it fails:
- "not a git repository" → the folder was copied with rsync; follow "Updating to a new version" in `DEPLOY.md`
  (one-time `git init` + `git reset --hard origin/main` — confirm with the user first; `.env` and data are not affected).
- `git pull` not fast-forward → the server has local commits; show `git log origin/main..HEAD` and ask the user.
- App not healthy → read `pm2 logs task-management --lines 80` and explain the error; don't guess-edit code on the server.
- If a stash was created, tell the user (`git stash show -p` shows it) — those edits may need to be added to the
  project on the developer's machine so they aren't lost.

## Rules on the live server

- Make a backup before anything risky: `npm run backup`.
- Don't run `npm run seed:demo` (demo accounts with a published password; the script refuses in production anyway).
- Don't edit application code here unless the user explicitly asks for an emergency fix. Normal changes are made on
  the developer's Mac, pushed to GitHub, then deployed with `npm run deploy`. If you do change code here, commit and
  push it so GitHub stays the source of truth.
- Forgotten password: `npm run reset-password -- <username>` (lists accounts when run without a name).
- Useful checks: `pm2 status`, `pm2 logs task-management --lines 80`, `sudo systemctl status apache2`,
  `sudo tail -50 /var/log/apache2/error.log`, `df -h` (disk space for uploads), `ls -lh /var/backups/task-management`.

## Development (on the developer's machine)

- Backend: `cd backend && npm run dev` (port 4000). Frontend: `cd frontend && npm run dev` (port 5173, proxies `/api`).
- Database migrations run automatically at startup in `backend/src/db.js` (additive; guarded so they run once).
- Access rules live on the server: `backend/src/access.js` (client portal scope), `canEditTask` / `isStaff` in
  `backend/src/routes/tasks.js`. Keep the UI and these rules in sync.
- After changes: `cd frontend && npx vite build && npx oxlint src`, test, commit, `git push`.
