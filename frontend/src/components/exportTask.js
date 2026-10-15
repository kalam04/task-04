// Plain-text export of tasks (details, estimate vs logged time, subtasks, time log, remarks, files).
// Fixed-width layout so it reads well in any text editor.
import { api } from '../api/client';
import { PRIORITIES, STATUSES, byValue, dueState, estimateSeconds, formatDuration, formatEstimate } from './constants';

const WIDTH = 72;
const LINE = '═'.repeat(WIDTH);
const RULE = '─'.repeat(WIDTH - 2);

// Dates arrive as "2026-10-18" (local day), "2026-10-15 09:21:35" (SQLite, UTC) or full ISO strings
const parseDate = (v) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00`);
  if (/^\d{4}-\d{2}-\d{2} \d/.test(v)) return new Date(`${v.replace(' ', 'T')}Z`);
  return new Date(v);
};
const fmtDate = (v) => (v ? parseDate(v).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (v) => parseDate(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDateTime = (iso) => `${fmtDate(iso)} ${fmtTime(iso)}`;
const formatBytes = (n) => (n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

// Wrap text to the page width, keeping the user's own line breaks
function wrap(text, indent = '  ') {
  const max = WIDTH - indent.length;
  return String(text).split(/\r?\n/).flatMap((para) => {
    if (!para.trim()) return [''];
    const lines = [];
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (line && (line + ' ' + word).length > max) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }).map((l) => (l ? indent + l : ''));
}

const field = (label, value) => `  ${label.padEnd(14)}: ${value}`;
const section = (title) => ['', `  ${title}`, `  ${RULE}`];

function dueText(task) {
  if (!task.due_date) return '—';
  const s = dueState(task);
  if (s?.kind === 'overdue') return `${fmtDate(task.due_date)}  (${s.days} day${s.days === 1 ? '' : 's'} OVERDUE)`;
  if (s?.kind === 'today') return `${fmtDate(task.due_date)}  (due TODAY)`;
  return fmtDate(task.due_date);
}

export function taskToText(task, { subtasks = [], entries = [], attachments = [] } = {}) {
  const now = Date.now();
  const logged = entries.reduce((sum, e) => sum + ((e.ended_at ? new Date(e.ended_at).getTime() : now) - new Date(e.started_at).getTime()), 0);
  const est = estimateSeconds(task);
  const out = [
    LINE,
    ...wrap(`TASK #${task.id} — ${task.title}`, ' '),
    LINE,
    field('Project', task.project_name),
    field('Client', task.client_name ?? '—'),
    ...(task.provided_by ? [field('Provided by', task.provided_by)] : []),
    field('Assigned to', task.developer_name ?? 'Unassigned'),
    field('Priority', byValue(PRIORITIES, task.priority).label),
    field('Status', byValue(STATUSES, task.status).label),
    field('Due date', dueText(task)),
    field('Created', `${fmtDate(task.created_at)}${task.created_by_name ? ` by ${task.created_by_name}` : ''}`),
    ...(task.completed_at ? [field('Completed', fmtDate(task.completed_at))] : []),

    ...section('TIME'),
    field('Estimate', formatEstimate(task) ?? 'Not set'),
    field('Time logged', `${formatDuration(logged)}${entries.some((e) => !e.ended_at) ? '  (timer running)' : ''}`),
  ];
  if (est) {
    const pct = Math.round((logged / 1000 / est) * 100);
    const diff = logged - est * 1000;
    out.push(field('Progress', `${pct}% of estimate  ${progressBar(pct)}`));
    out.push(field(diff > 0 ? 'Over by' : 'Remaining', formatDuration(Math.abs(diff))));
    if (task.estimate_unit === 'days') out.push('  (1 day = 8 working hours)');
  }

  if (task.description) out.push(...section('DESCRIPTION'), ...wrap(task.description));

  const done = subtasks.filter((s) => s.is_done).length;
  out.push(...section(`SUBTASKS (${done}/${subtasks.length} done)`));
  if (subtasks.length) subtasks.forEach((s) => out.push(...wrap(`[${s.is_done ? '✓' : ' '}] ${s.title}`).map((l, i) => (i ? `      ${l.trimStart()}` : l))));
  else out.push('  No subtasks');

  out.push(...section(`TIME LOG (${entries.length} slot${entries.length === 1 ? '' : 's'})`));
  if (entries.length) {
    out.push(`  ${'#'.padEnd(4)}${'Date'.padEnd(14)}${'Start'.padEnd(8)}${'End'.padEnd(8)}${'Duration'.padEnd(11)}Note`);
    entries.forEach((e, i) => {
      const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
      out.push(`  ${String(i + 1).padEnd(4)}${fmtDate(e.started_at).padEnd(14)}${fmtTime(e.started_at).padEnd(8)}${(e.ended_at ? fmtTime(e.ended_at) : 'running').padEnd(8)}${formatDuration(end - new Date(e.started_at).getTime()).padEnd(11)}${e.note ?? ''}`);
    });
    out.push(`  ${''.padEnd(34)}${'─'.repeat(9)}`, `  ${'Total'.padEnd(34)}${formatDuration(logged)}`);
  } else out.push('  No time logged yet');

  if (task.status === 'completed' && task.completion_remarks) out.push(...section('COMPLETION REMARKS'), ...wrap(task.completion_remarks));
  if (task.status === 'rejected' && task.reject_reason) out.push(...section('REJECTED — REASON'), ...wrap(task.reject_reason));

  if (attachments.length) {
    out.push(...section(`ATTACHMENTS (${attachments.length})`));
    attachments.forEach((a) => out.push(`  • ${a.is_voice ? 'Voice note' : a.original_name}  (${formatBytes(a.size)}, ${a.user_name ?? 'someone'})`));
  }
  return out.join('\n');
}

function progressBar(pct) {
  const cells = 20;
  const filled = Math.min(cells, Math.round((Math.min(pct, 100) / 100) * cells));
  return `[${'█'.repeat(filled)}${'░'.repeat(cells - filled)}]${pct > 100 ? ' OVER' : ''}`;
}

async function loadDetails(task) {
  const [subtasks, entries, attachments] = await Promise.all([
    api.get(`/tasks/${task.id}/subtasks`).then((r) => r.data),
    api.get(`/tasks/${task.id}/time-entries`).then((r) => r.data),
    api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
  ]);
  return { subtasks, entries, attachments };
}

const footer = (user) => ['', LINE, `  Exported ${fmtDateTime(new Date().toISOString())}${user ? ` by ${user.name}` : ''} · Task Management`, LINE, ''];

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
  const text = [taskToText(task, await loadDetails(task)), ...footer(user)].join('\n');
  download(`task-${task.id}${slug(task.title) ? `-${slug(task.title)}` : ''}.txt`, text);
}

// Several tasks in one file, with a short summary on top
export async function downloadTasks(tasks, user, title = 'My tasks') {
  const details = await Promise.all(tasks.map(loadDetails));
  const today = new Date().toISOString().slice(0, 10);
  const header = [
    LINE,
    `  ${title.toUpperCase()} — ${user?.name ?? ''}`,
    `  ${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${fmtDate(today)}`,
    LINE,
    '',
    `  ${'#'.padEnd(6)}${'Priority'.padEnd(10)}${'Status'.padEnd(13)}${'Due'.padEnd(14)}Title`,
    `  ${RULE}`,
    ...tasks.map((t) => `  ${String(t.id).padEnd(6)}${byValue(PRIORITIES, t.priority).label.padEnd(10)}${byValue(STATUSES, t.status).label.padEnd(13)}${(t.due_date ? fmtDate(t.due_date) : '—').padEnd(14)}${t.title}`),
    '',
  ];
  const body = tasks.map((t, i) => taskToText(t, details[i])).join('\n\n\n');
  download(`${slug(title) || 'tasks'}-${today}.txt`, [...header, body, ...footer(user)].join('\n'));
}
