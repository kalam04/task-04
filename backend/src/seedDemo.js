// Demo data for trying the app.
//   npm run seed:demo          add demo projects, clients, developers and tasks
//   npm run seed:demo:remove   remove everything this script added
// Demo developers sign in with their username and the password below.
import bcrypt from 'bcryptjs';
import { db, transaction } from './db.js';
import { logActivity, notify } from './activity.js';

const DEMO_PASSWORD = 'demo1234';

const DEVELOPERS = [
  { username: 'rahim', name: 'Rahim Uddin' },
  { username: 'nusrat', name: 'Nusrat Jahan' },
  { username: 'tanvir', name: 'Tanvir Hasan' },
];

const PROJECTS = [
  {
    name: 'Demo: E-commerce Website',
    description: 'Online shop with cart, checkout and admin panel',
    clients: [{ name: 'Daraz Fashion', email: 'it@darazfashion.example', phone: '01711-000001' }, { name: 'Bengal Gadgets', email: 'ops@bengalgadgets.example' }],
  },
  {
    name: 'Demo: Mobile Banking App',
    description: 'Android & iOS app for account balance, transfers and bill pay',
    clients: [{ name: 'Padma Bank', email: 'digital@padmabank.example', phone: '01811-000002' }],
  },
  {
    name: 'Demo: Company CRM',
    description: 'Internal CRM for the sales team',
    clients: [{ name: 'Internal - Sales Team' }, { name: 'Meghna Group', email: 'crm@meghna.example' }],
  },
];

const H = 3600_000;
const D = 24 * H;
// Time slots are given as [hoursAgoStart, hoursAgoEnd]; null end = timer running
const TASKS = [
  {
    title: 'Design product listing page', project: 0, client: 0, dev: 'rahim', priority: 'high', status: 'completed',
    estimate: [2, 'days'], due: -2, description: 'Grid of products with filters for category, price and brand.',
    subtasks: [['Wireframe', 1], ['Filter sidebar', 1], ['Responsive layout', 1]],
    slots: [[96, 92, 'Wireframes'], [72, 66, 'Built grid + filters'], [50, 47, 'Mobile fixes']],
  },
  {
    title: 'Implement shopping cart', project: 0, client: 0, dev: 'rahim', priority: 'urgent', status: 'in_progress',
    estimate: [3, 'days'], due: 2, description: 'Add/remove items, quantity update, persist cart for logged-in users.',
    subtasks: [['Cart API', 1], ['Cart drawer UI', 1], ['Persist cart in DB', 0], ['Unit tests', 0]],
    slots: [[30, 26, 'Cart API'], [8, 4.5, 'Drawer UI'], [0.7, null]],
  },
  {
    title: 'Payment gateway integration (bKash, Nagad)', project: 0, client: 1, dev: 'nusrat', priority: 'urgent', status: 'pending',
    estimate: [5, 'days'], due: 7, description: 'Integrate bKash and Nagad checkout APIs with sandbox first.',
    subtasks: [['Get sandbox credentials from client', 0], ['bKash checkout', 0], ['Nagad checkout', 0], ['Refund flow', 0]],
    slots: [],
  },
  {
    title: 'Fix product image upload on Safari', project: 0, client: 1, dev: 'tanvir', priority: 'medium', status: 'rejected',
    estimate: [4, 'hours'], due: null, rejectReason: 'Cannot reproduce on Safari 18; need a screen recording from the client.',
    subtasks: [['Reproduce bug', 1]],
    slots: [[20, 19, 'Tried to reproduce']],
  },
  {
    title: 'Admin order management screen', project: 0, client: 0, dev: 'tanvir', priority: 'low', status: 'pending',
    estimate: null, due: 14, description: 'List, search and update order status.',
    subtasks: [], slots: [],
  },
  {
    title: 'Login with fingerprint / Face ID', project: 1, client: 0, dev: 'nusrat', priority: 'high', status: 'in_progress',
    estimate: [16, 'hours'], due: 3, description: 'Biometric login on both platforms with PIN fallback.',
    subtasks: [['Android BiometricPrompt', 1], ['iOS LocalAuthentication', 0], ['PIN fallback', 0]],
    slots: [[52, 48, 'Android'], [28, 25, 'Android tests'], [6, 3, 'iOS setup']],
  },
  {
    title: 'Fund transfer between own accounts', project: 1, client: 0, dev: 'rahim', priority: 'urgent', status: 'completed',
    estimate: [2, 'days'], due: -1,
    subtasks: [['Transfer form', 1], ['OTP confirmation', 1], ['Receipt screen', 1]],
    slots: [[120, 115, null], [100, 94, 'OTP flow'], [76, 73, 'Receipt + QA fixes']],
  },
  {
    title: 'Electricity bill payment (DESCO)', project: 1, client: 0, dev: 'tanvir', priority: 'medium', status: 'in_progress',
    estimate: [1, 'days'], due: -1, description: 'Overdue — client asked for this in the last release.',
    subtasks: [['Biller API', 1], ['Bill lookup screen', 0]],
    slots: [[26, 22, 'Biller API']],
  },
  {
    title: 'Push notifications for transactions', project: 1, client: 0, dev: 'nusrat', priority: 'medium', status: 'pending',
    estimate: [6, 'hours'], due: 10,
    subtasks: [['Firebase setup', 0], ['Notification templates', 0]], slots: [],
  },
  {
    title: 'Lead import from Excel', project: 2, client: 0, dev: 'tanvir', priority: 'medium', status: 'completed',
    estimate: [5, 'hours'], due: -4,
    subtasks: [['Parse .xlsx', 1], ['Duplicate detection', 1]],
    slots: [[150, 147, null], [126, 124, 'Duplicates']],
  },
  {
    title: 'Sales pipeline kanban board', project: 2, client: 1, dev: 'rahim', priority: 'high', status: 'pending',
    estimate: [3, 'days'], due: 5, description: 'Drag deals between stages: New, Contacted, Proposal, Won, Lost.',
    subtasks: [['Stage model', 0], ['Drag & drop', 0], ['Stage totals', 0]], slots: [],
  },
  {
    title: 'Monthly sales report export (PDF)', project: 2, client: 1, dev: 'nusrat', priority: 'low', status: 'in_progress',
    estimate: [8, 'hours'], due: 6,
    subtasks: [['Report query', 1], ['PDF layout', 0]],
    slots: [[10, 8, 'Report query']],
  },
  {
    title: 'Customer follow-up reminders', project: 2, client: 0, dev: null, priority: 'medium', status: 'pending',
    estimate: null, due: 12, description: 'Not assigned yet — pick a developer.',
    subtasks: [], slots: [],
  },
  {
    title: 'Set up staging server', project: 2, client: null, dev: 'tanvir', priority: 'high', status: 'completed',
    estimate: [4, 'hours'], due: -6,
    subtasks: [['Provision VM', 1], ['CI deploy', 1]],
    slots: [[170, 167.5, null], [146, 145, 'CI deploy']],
  },
];

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const dateOnly = (days) => new Date(Date.now() + days * D).toISOString().slice(0, 10);
const demoUsernames = DEVELOPERS.map((d) => d.username);
const demoProjectNames = PROJECTS.map((p) => p.name);

// Marketing & Support demo accounts, with tasks that show the developer-request flow
const STAFF = [
  { username: 'sadia', name: 'Sadia Rahman', role: 'marketing' },
  { username: 'imran', name: 'Imran Hossain', role: 'support' },
];
const staffUsernames = STAFF.map((u) => u.username);

// by: staff username · project: index into PROJECTS · request: { dev, message, state }
const STAFF_TASKS = [
  {
    by: 'sadia', project: 0, client: 0, title: 'Eid campaign banner on the homepage', priority: 'high', due: 3,
    description: 'Full-width banner with countdown timer and "Shop the Eid collection" button. Designs are in the shared drive.',
    request: { dev: 'nusrat', message: 'Campaign goes live on Monday — can you take this?', state: 'pending' },
    comment: 'Brand colours: #0B5 green and white. Mobile version is the priority.',
  },
  {
    by: 'sadia', project: 2, client: 1, title: 'Add UTM tracking to signup links', priority: 'medium', due: 10,
    description: 'All signup links in the newsletter should carry utm_source / utm_medium / utm_campaign.',
  },
  {
    by: 'imran', project: 1, client: 0, title: 'Customer cannot reset password (ticket #4821)', priority: 'urgent', due: 1,
    description: 'Customer gets "link expired" immediately after requesting a reset. Happens on Android only. Customer phone: Samsung A54.',
    request: { dev: 'tanvir', message: 'Customer is waiting on the phone line, please check today', state: 'pending' },
    comment: 'I asked the customer to try again with the latest app version — same error.',
  },
  {
    by: 'imran', project: 2, client: 0, title: 'Export button missing for some users', priority: 'high', due: 5, status: 'in_progress',
    description: 'Three sales reps report the "Export to Excel" button is not visible on the Leads page.',
    request: { dev: 'rahim', message: 'Reported by 3 sales reps this morning', state: 'accepted' },
  },
];

function addDemoStaff() {
  const existing = db.prepare(`SELECT username FROM users WHERE username IN (${staffUsernames.map(() => '?').join(',')})`).all(...staffUsernames);
  if (existing.length) {
    console.log(`Demo Marketing/Support accounts already present (${existing.map((u) => u.username).join(', ')}).`);
    return;
  }
  const projectIds = PROJECTS.map((p) => db.prepare('SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL').get(p.name)?.id);
  if (projectIds.some((id) => !id)) {
    console.log('Demo projects are missing, so no Marketing/Support demo tasks were added.');
    return;
  }
  const devId = (u) => db.prepare(`SELECT id FROM users WHERE username = ? AND role = 'developer' AND deleted_at IS NULL`).get(u)?.id;
  transaction(() => {
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    const staff = {};
    for (const u of STAFF) {
      const id = db.prepare('INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(u.username, u.name, hash, u.role).lastInsertRowid;
      staff[u.username] = { id, name: u.name };
    }
    for (const t of STAFF_TASKS) {
      const author = staff[t.by];
      const clientId = t.client == null ? null
        : db.prepare('SELECT id FROM clients WHERE project_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET ?').get(projectIds[t.project], t.client)?.id ?? null;
      const dev = t.request ? devId(t.request.dev) : null;
      const assigned = t.request?.state === 'accepted' && dev ? dev : null;
      const taskId = db.prepare(`
        INSERT INTO tasks (title, description, project_id, client_id, developer_id, priority, status, due_date, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(t.title, t.description ?? null, projectIds[t.project], clientId, assigned, t.priority, t.status ?? 'pending',
        dateOnly(t.due), author.id, iso(2 * H)).lastInsertRowid;
      logActivity(taskId, author.id, 'created the task');
      if (t.request && dev) {
        const state = t.request.state;
        db.prepare(`INSERT INTO assignment_requests (task_id, developer_id, requested_by, message, status, created_at, responded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(taskId, dev, author.id, t.request.message, state, iso(1.5 * H), state === 'pending' ? null : iso(H));
        logActivity(taskId, author.id, `asked ${DEVELOPERS.find((d) => d.username === t.request.dev).name} to take the task: "${t.request.message}"`);
        if (state === 'pending') {
          notify([dev], { taskId, actorId: author.id, type: 'request', message: `${author.name} asked you to take "${t.title}": ${t.request.message}` });
        } else {
          logActivity(taskId, dev, 'accepted the request and took the task');
          notify([author.id], { taskId, actorId: dev, type: 'request_accepted', message: `${DEVELOPERS.find((d) => d.username === t.request.dev).name} accepted "${t.title}" and is now assigned` });
        }
      }
      if (t.comment) {
        db.prepare('INSERT INTO task_comments (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(taskId, author.id, t.comment, iso(H));
      }
    }
    console.log(`Added Marketing/Support demo accounts (${staffUsernames.join(', ')}) and ${STAFF_TASKS.length} tasks. Password is DEMO_PASSWORD in src/seedDemo.js.`);
  });
}

function removeDemo() {
  transaction(() => {
    const projectIds = db.prepare(`SELECT id FROM projects WHERE name IN (${demoProjectNames.map(() => '?').join(',')})`)
      .all(...demoProjectNames).map((r) => r.id);
    for (const id of projectIds) {
      db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id); // time slots + subtasks cascade
      db.prepare('DELETE FROM clients WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    }
    const userIds = db.prepare(`SELECT id FROM users WHERE role = 'developer' AND username IN (${demoUsernames.map(() => '?').join(',')})`)
      .all(...demoUsernames).map((r) => r.id);
    for (const id of userIds) db.prepare('DELETE FROM users WHERE id = ?').run(id);
    const staffIds = db.prepare(`SELECT id FROM users WHERE role IN ('marketing','support') AND username IN (${staffUsernames.map(() => '?').join(',')})`)
      .all(...staffUsernames).map((r) => r.id);
    for (const id of staffIds) {
      db.prepare('DELETE FROM assignment_requests WHERE requested_by = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }
    console.log(`Removed ${projectIds.length} demo project(s), ${userIds.length} demo developer(s) and ${staffIds.length} Marketing/Support account(s)`);
  });
}

function addDemo() {
  const existing = db.prepare(`SELECT username FROM users WHERE username IN (${demoUsernames.map(() => '?').join(',')})`).all(...demoUsernames);
  if (existing.length) {
    console.log(`Demo data already present (${existing.map((u) => u.username).join(', ')}). Run "npm run seed:demo:remove" first to recreate it.`);
    return;
  }
  const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get();
  transaction(() => {
    const devIds = {};
    const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
    for (const d of DEVELOPERS) {
      devIds[d.username] = db.prepare(`INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, 'developer')`)
        .run(d.username, d.name, hash).lastInsertRowid;
    }
    const projects = PROJECTS.map((p) => {
      const id = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)').run(p.name, p.description).lastInsertRowid;
      const clientIds = p.clients.map((c) => db.prepare('INSERT INTO clients (project_id, name, email, phone) VALUES (?, ?, ?, ?)')
        .run(id, c.name, c.email ?? null, c.phone ?? null).lastInsertRowid);
      return { id, clientIds };
    });

    for (const t of TASKS) {
      const project = projects[t.project];
      const devId = t.dev ? devIds[t.dev] : null;
      const lastEnd = t.slots.length ? t.slots[t.slots.length - 1][1] : null;
      const taskId = db.prepare(`
        INSERT INTO tasks (title, description, project_id, client_id, developer_id, priority, status, reject_reason,
          due_date, estimate_value, estimate_unit, estimate_set_at, completed_at, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        t.title, t.description ?? null, project.id, t.client == null ? null : project.clientIds[t.client], devId,
        t.priority, t.status, t.rejectReason ?? null, t.due == null ? null : dateOnly(t.due),
        t.estimate?.[0] ?? null, t.estimate?.[1] ?? null, t.estimate ? iso(200 * H) : null,
        t.status === 'completed' && lastEnd != null ? iso(lastEnd * H) : null, admin?.id ?? null, iso(10 * D),
      ).lastInsertRowid;
      for (const [title, done] of t.subtasks) {
        db.prepare('INSERT INTO subtasks (task_id, title, is_done, done_at, created_by) VALUES (?, ?, ?, ?, ?)')
          .run(taskId, title, done, done ? iso(2 * D) : null, devId ?? admin?.id ?? null);
      }
      for (const [startAgo, endAgo, note] of t.slots) {
        db.prepare('INSERT INTO time_entries (task_id, user_id, started_at, ended_at, note) VALUES (?, ?, ?, ?, ?)')
          .run(taskId, devId, iso(startAgo * H), endAgo == null ? null : iso(endAgo * H), note ?? null);
      }
    }
    console.log(`Added ${PROJECTS.length} projects, ${DEVELOPERS.length} developers and ${TASKS.length} tasks.`);
    console.log(`Developer logins: ${demoUsernames.join(', ')} (password is DEMO_PASSWORD in src/seedDemo.js)`);
  });
}

if (process.argv.includes('--remove')) removeDemo();
else if (process.env.NODE_ENV === 'production') {
  // Demo developers share a published password, so never create them on a live server
  console.error('Refusing to add demo data with NODE_ENV=production.');
  process.exitCode = 1;
} else {
  addDemo();
  addDemoStaff();
}
