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
- **Marketing & Support (`marketing`, `support`):** created by admins on the Marketing & Support page. They see every task, create tasks, edit any task's details (not delete), comment and attach files. They don't assign directly: they **request a developer**, who gets a notification and can **Accept** (the task is assigned to them) or **Decline** with a reason. The requester or an admin can cancel; assigning directly cancels pending requests. Status, time, estimate and subtasks stay with the assignee and admins.
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
- **My Dashboard (developers):** their landing page — running timer with Stop/Start, open/due today/overdue counts, hours today and this week, a priority-ordered focus list with estimate progress, hours per day this week, this week by project, recent comments on their tasks, and unassigned tasks to pick up.
- **Dashboard & Reports (admin; view-only for Marketing & Support):** hours by developer/project/client for any period, current workload, estimate vs actual (1 day = 8 hours), and Excel (CSV) export of timesheets and summaries.
- **Admins (admin):** create more admin accounts on the Admins page; you can't delete yourself or the last admin, and deleted admins go to Trash.
- **Accounts:** everyone can change their own password; 10 wrong passwords lock that login for 15 minutes.
- **Attachments:** attach any file (documents, images, PDFs, audio, video…) when creating a task or from a task's Files tab — drag & drop, multiple files, upload progress — or record a **voice note** in the browser. Images preview, audio/video play inline. Up to 2 GB per file by default (`MAX_UPLOAD_MB`). Files are stored in `backend/uploads/` (`UPLOAD_DIR`) and downloaded through short-lived signed links; anyone who can see a task can attach, the uploader or an admin can delete (to Trash).
- **Task provided by:** optional free-text name of whoever gave or asked for the task (client contact, manager…), with suggestions from earlier names; shown on the task and searchable.
- **Developers create tasks:** the New Task form is open to developers (assigned to themselves by default); they can edit their own open tasks but only admins reassign or delete.
- **Completion remarks:** completing a task asks for optional remarks; the assignee or an admin can add or edit them afterwards. Shown in the list and on the task, and sent to admins.
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
