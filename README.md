# Task Management

- `frontend/` — React (Vite) + Material UI + React Router + Axios
- `backend/` — Node.js + Express, JWT auth, SQLite (built-in `node:sqlite`, file `backend/data.db`)

## Run (development)

```bash
cd backend && npm install && npm run dev    # http://localhost:4000
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The default user is created on first backend start from `DEFAULT_USERNAME` / `DEFAULT_PASSWORD` in `backend/.env` (see `backend/.env.example`).

## Features

- **Roles:** `admin` manages everything. A `developer` can view every task but change only tasks assigned to them; they can assign an unassigned task to themselves or any developer (only admin can reassign an assigned task).
- **Projects & Clients:** each project has many clients.
- **Developers:** created by admin with a username/password so they can sign in.
- **Tasks:** belong to a project, optional client (must be in that project), assigned developer, priority (low/medium/high/urgent), optional due date.
- **Status flow:** pending → in_progress → completed / rejected (reason required). Developers can start, complete or reject their own open tasks; only admin can reopen a closed task.
- **Time estimate:** the assigned developer (or admin) sets how long a task needs, in hours or days.
- **Time log:** a task can have many time slots. Start/Stop timer opens and closes a slot (starting a pending task moves it to In Progress; completing or rejecting stops the timer). Slots can also be added/edited by hand; overlapping slots are rejected. "Time taken" = sum of all slots.
- **Subtasks:** checklist per task; the admin and the assigned developer can add, tick and delete them (deleted subtasks go to Trash).
- **Comments:** everyone who can see a task can discuss it; authors edit their own comments, authors/admins delete (shown as "comment deleted").
- **History:** every change to a task (status, assignment, priority, due date, estimate, subtasks, time slots) is logged with who and when.
- **Notifications:** bell in the top bar — assigned to you, your task's status changed, a developer completed/rejected a task (admins), new comments, and overdue tasks (checked hourly).
- **Overdue:** open tasks past their due date are highlighted in red with "N days overdue".
- **Dashboard & Reports (admin):** hours by developer/project/client for any period, current workload, estimate vs actual (1 day = 8 hours), and Excel (CSV) export of timesheets and summaries.
- **Accounts:** everyone can change their own password; 10 wrong passwords lock that login for 15 minutes.
- **Soft delete & Trash:** deleting a task, project, client or developer moves it to Trash (admin only) where it can be restored. Deleting a project also trashes its clients and tasks; restoring the project brings them back. Trashed developers cannot sign in.

## Demo data

```bash
cd backend && npm run seed:demo          # adds 3 "Demo:" projects, 3 developers, 14 tasks
cd backend && npm run seed:demo:remove   # removes exactly that demo data
```

Demo developers: `rahim`, `nusrat`, `tanvir` — password is `DEMO_PASSWORD` in `backend/src/seedDemo.js`.

## Production

See **[DEPLOY.md](DEPLOY.md)** for putting it on a server (one Node process serves the app and API, Nginx for HTTPS, PM2 to keep it running).

```bash
npm run install:all && npm run build && npm start
```

The database is backed up automatically once a day (`backend/backups/` by default, newest 14 kept). Make one by hand with `npm run backup`.
