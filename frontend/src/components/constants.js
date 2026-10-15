export const PRIORITIES = [
  { value: 'low', label: 'Low', color: 'default' },
  { value: 'medium', label: 'Medium', color: 'info' },
  { value: 'high', label: 'High', color: 'warning' },
  { value: 'urgent', label: 'Urgent', color: 'error' },
];

export const STATUSES = [
  { value: 'pending', label: 'Pending', color: 'default' },
  { value: 'in_progress', label: 'In Progress', color: 'primary' },
  { value: 'completed', label: 'Completed', color: 'success' },
  { value: 'rejected', label: 'Rejected', color: 'error' },
];

export const byValue = (list, value) => list.find((i) => i.value === value) ?? list[0];

export const errorMessage = (err) => err.response?.data?.message || err.message || 'Something went wrong';

export const formatEstimate = (t) => {
  if (t.estimate_value == null) return null;
  const n = Number(t.estimate_value);
  const unit = t.estimate_unit === 'days' ? 'day' : 'hour';
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
};

export const formatDuration = (ms) => {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  return [d && `${d}d`, h && `${h}h`, (m || (!d && !h)) && `${m}m`].filter(Boolean).join(' ');
};

export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// <input type="datetime-local"> works in local time without a zone: convert to/from ISO (UTC)
export const isoToLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const localInputToIso = (value) => (value ? new Date(value).toISOString() : null);

export const timeAgo = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
};

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Due-date state for open tasks: 'overdue' (with days late), 'today', or null
export const dueState = (task) => {
  if (!task.due_date || !['pending', 'in_progress'].includes(task.status)) return null;
  const today = localDate(new Date());
  if (task.due_date === today) return { kind: 'today' };
  if (task.due_date > today) return null;
  const days = Math.round((new Date(today) - new Date(task.due_date)) / 86400000);
  return { kind: 'overdue', days };
};
