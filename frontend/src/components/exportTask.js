// Plain-text summary export of tasks: key fields incl. created time, estimate and time logged.
// Fixed-width layout so it reads well in any text editor.
import { PRIORITIES, STATUSES, byValue, dueState, estimateSeconds, formatEstimate } from './constants';
import { totalMs } from './useNow';

// Dates arrive as "2026-10-18" (local day), "2026-10-15 09:21:35" (SQLite, UTC) or full ISO strings
const parseDate = (v) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00`);
  if (/^\d{4}-\d{2}-\d{2} \d/.test(v)) return new Date(`${v.replace(' ', 'T')}Z`);
  return new Date(v);
};
const fmtDate = (v) => (v ? parseDate(v).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (v) => parseDate(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDateTime = (v) => (v ? `${fmtDate(v)} ${fmtTime(v)}` : '—');

// Hours and minutes only (no "days"), so it never clashes with 8-hour working-day estimates
const hm = (ms) => {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};

const loggedText = (task, now) => {
  const ms = totalMs(task, now);
  if (!ms) return '—';
  const est = estimateSeconds(task);
  return `${hm(ms)}${est ? ` (${Math.round((ms / 1000 / est) * 100)}% of estimate)` : ''}${task.running_since ? ' · timer running' : ''}`;
};

const dueText = (task) => {
  if (!task.due_date) return '—';
  const s = dueState(task);
  if (s?.kind === 'overdue') return `${fmtDate(task.due_date)} (${s.days}d OVERDUE)`;
  if (s?.kind === 'today') return `${fmtDate(task.due_date)} (TODAY)`;
  return fmtDate(task.due_date);
};

// Fit text into a column: cut with "…" when too long, then pad
const cell = (text, width) => {
  const s = String(text ?? '—');
  return (s.length > width - 1 ? `${s.slice(0, width - 2)}…` : s).padEnd(width);
};

// One task as a short summary block
export function taskSummaryText(task, user) {
  const now = Date.now();
  const width = 64;
  const line = '═'.repeat(width);
  const field = (label, value) => `  ${label.padEnd(13)}: ${value}`;
  return [
    line,
    ` TASK #${task.id} — ${task.title}`,
    line,
    field('Project', task.project_name),
    field('Client', task.client_name ?? '—'),
    ...(task.provided_by ? [field('Provided by', task.provided_by)] : []),
    field('Assigned to', task.developer_name ?? 'Unassigned'),
    field('Priority', byValue(PRIORITIES, task.priority).label),
    field('Status', byValue(STATUSES, task.status).label),
    field('Created', `${fmtDateTime(task.created_at)}${task.created_by_name ? ` by ${task.created_by_name}` : ''}`),
    field('Estimate', formatEstimate(task) ?? 'Not set'),
    field('Time logged', loggedText(task, now)),
    field('Subtasks', task.subtask_total ? `${task.subtask_done}/${task.subtask_total} done` : '—'),
    field('Due date', dueText(task)),
    ...(task.completed_at ? [field('Completed', fmtDateTime(task.completed_at))] : []),
    line,
    `  Exported ${fmtDateTime(new Date().toISOString())}${user ? ` by ${user.name}` : ''}`,
    '',
  ].join('\n');
}

// Many tasks as one summary table
export function tasksSummaryText(tasks, user, title) {
  const now = Date.now();
  const cols = [
    ['#', 5, (t) => t.id],
    ['Task', 38, (t) => t.title],
    ['Project', 22, (t) => t.project_name],
    ['Priority', 10, (t) => byValue(PRIORITIES, t.priority).label],
    ['Status', 13, (t) => byValue(STATUSES, t.status).label],
    ['Created', 20, (t) => fmtDateTime(t.created_at)],
    ['Estimate', 11, (t) => formatEstimate(t) ?? '—'],
    ['Logged', 11, (t) => (totalMs(t, now) ? hm(totalMs(t, now)) : '—')],
    ['Due', 22, (t) => dueText(t)],
  ];
  const width = cols.reduce((s, [, w]) => s + w, 2);
  const row = (values) => `  ${values.map((v, i) => cell(v, cols[i][1])).join('')}`.trimEnd();
  const estTotal = tasks.reduce((s, t) => s + (estimateSeconds(t) ?? 0), 0);
  const loggedTotal = tasks.reduce((s, t) => s + totalMs(t, now), 0);
  return [
    '═'.repeat(width),
    `  ${title.toUpperCase()}${user ? ` — ${user.name}` : ''}`,
    `  ${tasks.length} task${tasks.length === 1 ? '' : 's'} · exported ${fmtDateTime(new Date().toISOString())}`,
    '═'.repeat(width),
    row(cols.map(([label]) => label)),
    `  ${'─'.repeat(width - 2)}`,
    ...tasks.map((t) => row(cols.map(([, , get]) => get(t)))),
    `  ${'─'.repeat(width - 2)}`,
    row(['', 'Total', '', '', '', '', estTotal ? hm(estTotal * 1000) : '—', loggedTotal ? hm(loggedTotal) : '—', '']),
    tasks.some((t) => t.estimate_unit === 'days') ? '  (estimates in days count as 8 working hours)' : '',
    '',
  ].join('\n');
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function download(filename, text) {
  // BOM + CRLF so Windows Notepad shows Bangla and line breaks correctly
  const blob = new Blob(['﻿', text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadTask(task, user) {
  download(`task-${task.id}${slug(task.title) ? `-${slug(task.title)}` : ''}.txt`, taskSummaryText(task, user));
}

export async function downloadTasks(tasks, user, title = 'My tasks') {
  download(`${slug(title) || 'tasks'}-${new Date().toISOString().slice(0, 10)}.txt`, tasksSummaryText(tasks, user, title));
}
