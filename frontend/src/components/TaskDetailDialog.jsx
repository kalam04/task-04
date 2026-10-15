import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  LinearProgress, List, ListItem, ListItemIcon, ListItemText, Paper, Stack, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import { useAuth } from '../context/AuthContext';
import { FilesTab } from './Attachments';
import { RequestBanner } from './Requests';
import { downloadTask } from './exportTask';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import { api } from '../api/client';
import {
  ROLE_LABELS, STATUSES, byValue, errorMessage, formatDateTime, formatDuration, formatEstimate, isStaffRole,
  isoToLocalInput, localInputToIso, timeAgo,
} from './constants';
import ConfirmDialog from './ConfirmDialog';
import useNow, { totalMs } from './useNow';

function SubtasksTab({ task, editable, onChanged, notify }) {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');

  const load = useCallback(() => api.get(`/tasks/${task.id}/subtasks`).then((r) => setItems(r.data)), [task.id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, message) => {
    try {
      await fn();
      if (message) notify(message);
      load();
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const add = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    run(() => api.post(`/tasks/${task.id}/subtasks`, { title }), null).then(() => setTitle(''));
  };

  const done = items.filter((s) => s.is_done).length;

  return (
    <Box>
      {!!items.length && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">Progress</Typography>
            <Typography variant="body2" color="text.secondary">{done} / {items.length} done</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={(done / items.length) * 100} sx={{ height: 8, borderRadius: 4 }} />
        </Box>
      )}
      <List dense disablePadding>
        {items.map((s) => (
          <ListItem key={s.id} disableGutters secondaryAction={editable && (
            <Tooltip title="Move to Trash">
              <IconButton size="small" edge="end" onClick={() => run(() => api.delete(`/tasks/${task.id}/subtasks/${s.id}`), 'Subtask moved to Trash')}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <Checkbox edge="start" checked={!!s.is_done} disabled={!editable}
                onChange={(e) => run(() => api.patch(`/tasks/${task.id}/subtasks/${s.id}`, { is_done: e.target.checked }))} />
            </ListItemIcon>
            <ListItemText primary={s.title}
              slotProps={{ primary: { sx: s.is_done ? { textDecoration: 'line-through', color: 'text.secondary' } : undefined } }} />
          </ListItem>
        ))}
        {!items.length && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No subtasks yet.</Typography>}
      </List>
      {editable && (
        <Stack component="form" onSubmit={add} direction="row" spacing={1} sx={{ mt: 2 }}>
          <TextField size="small" fullWidth placeholder="Add a subtask…" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Button type="submit" variant="outlined" startIcon={<AddIcon />} disabled={!title.trim()}>Add</Button>
        </Stack>
      )}
    </Box>
  );
}

const emptySlot = { started_at: '', ended_at: '', note: '' };

function TimeLogTab({ task, isAdmin, editable, canStart, onChanged, notify }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(null); // { id?, started_at, ended_at, note } in local input format
  const [deleting, setDeleting] = useState(null);
  const now = useNow(!!task.running_since, 1000);

  const load = useCallback(() => api.get(`/tasks/${task.id}/time-entries`).then((r) => setEntries(r.data)), [task.id]);
  useEffect(() => { load(); }, [load, task.running_since]);

  const run = async (fn, message) => {
    try {
      await fn();
      notify(message);
      load();
      onChanged();
      return true;
    } catch (err) {
      notify(errorMessage(err), 'error');
      return false;
    }
  };

  const saveSlot = async () => {
    const payload = { started_at: localInputToIso(form.started_at), ended_at: localInputToIso(form.ended_at), note: form.note };
    const ok = await run(
      () => (form.id ? api.put(`/tasks/${task.id}/time-entries/${form.id}`, payload) : api.post(`/tasks/${task.id}/time-entries`, payload)),
      form.id ? 'Time slot updated' : 'Time slot added',
    );
    if (ok) setForm(null);
  };

  const startMs = form?.started_at ? new Date(form.started_at).getTime() : null;
  const endMs = form?.ended_at ? new Date(form.ended_at).getTime() : null;
  const formError = form && (!startMs ? 'Start time is required'
    : endMs && endMs <= startMs ? 'End time must be after the start time' : '');
  const nowInput = () => isoToLocalInput(new Date().toISOString());

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="body2" color="text.secondary">Total time taken</Typography>
            <Typography variant="h5" fontWeight={600}>{formatDuration(totalMs(task, now))}</Typography>
            <Typography variant="body2" color="text.secondary">
              {entries.length} time slot{entries.length === 1 ? '' : 's'}
              {task.estimate_value != null && ` · Estimate ${formatEstimate(task)}`}
            </Typography>
          </Box>
          {task.running_since ? (
            <Button variant="contained" color="error" startIcon={<StopIcon />}
              onClick={() => run(() => api.post(`/tasks/${task.id}/timer/stop`), 'Timer stopped')}>
              Stop timer ({formatDuration(now - new Date(task.running_since).getTime())})
            </Button>
          ) : canStart && (
            <Button variant="contained" startIcon={<PlayArrowIcon />}
              onClick={() => run(() => api.post(`/tasks/${task.id}/timer/start`), 'Timer started')}>
              Start timer
            </Button>
          )}
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ '& th, & td': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell>Start</TableCell><TableCell>End</TableCell><TableCell>Duration</TableCell>
              <TableCell>Note</TableCell>{isAdmin && <TableCell>By</TableCell>}<TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell>{formatDateTime(e.started_at)}</TableCell>
                <TableCell>{e.ended_at ? formatDateTime(e.ended_at) : <Chip size="small" color="primary" label="Running" />}</TableCell>
                <TableCell>{formatDuration((e.ended_at ? new Date(e.ended_at).getTime() : now) - new Date(e.started_at).getTime())}</TableCell>
                <TableCell sx={{ whiteSpace: 'normal !important', minWidth: 120 }}>{e.note || '—'}</TableCell>
                {isAdmin && <TableCell>{e.user_name || '—'}</TableCell>}
                <TableCell align="right">
                  {editable && (
                    <>
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setForm({
                        id: e.id, started_at: isoToLocalInput(e.started_at), ended_at: isoToLocalInput(e.ended_at), note: e.note ?? '',
                      })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(e)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!entries.length && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>No time logged yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {editable && !form && (
        <Button startIcon={<AddIcon />} sx={{ mt: 2 }} onClick={() => setForm(emptySlot)}>Add time slot manually</Button>
      )}
      {form && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography fontWeight={600} sx={{ mb: 2 }}>{form.id ? 'Edit time slot' : 'New time slot'}</Typography>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Stack direction="row" spacing={1} sx={{ flex: 1, alignItems: 'center' }}>
                <TextField label="Start time" type="datetime-local" fullWidth size="small" value={form.started_at}
                  onChange={(e) => setForm((f) => ({ ...f, started_at: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
                <Button size="small" onClick={() => setForm((f) => ({ ...f, started_at: nowInput() }))}>Now</Button>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ flex: 1, alignItems: 'center' }}>
                <TextField label="End time" type="datetime-local" fullWidth size="small" value={form.ended_at}
                  onChange={(e) => setForm((f) => ({ ...f, ended_at: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }}
                  helperText="Leave empty if still working" />
                <Button size="small" onClick={() => setForm((f) => ({ ...f, ended_at: nowInput() }))}>Now</Button>
              </Stack>
            </Stack>
            <TextField label="Note (optional)" size="small" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            {formError ? <Alert severity="error">{formError}</Alert> : startMs && endMs && (
              <Alert severity="info">Duration: {formatDuration(endMs - startMs)}</Alert>
            )}
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => setForm(null)}>Cancel</Button>
              <Button variant="contained" disabled={!!formError} onClick={saveSlot}>Save slot</Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      <ConfirmDialog open={!!deleting} title="Delete time slot" confirmLabel="Delete"
        message={deleting && `Delete the slot ${formatDateTime(deleting.started_at)} → ${deleting.ended_at ? formatDateTime(deleting.ended_at) : 'running'}?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => { run(() => api.delete(`/tasks/${task.id}/time-entries/${deleting.id}`), 'Time slot deleted'); setDeleting(null); }} />
    </Box>
  );
}

const initials = (name = '?') => name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

function CommentsTab({ task, onChanged, notify }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState(null); // { id, body }
  const [deleting, setDeleting] = useState(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => api.get(`/tasks/${task.id}/comments`).then((r) => setComments(r.data)), [task.id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    try {
      const r = await fn();
      setComments(r.data);
      onChanged();
      return true;
    } catch (err) {
      notify(errorMessage(err), 'error');
      return false;
    }
  };

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    if (await run(() => api.post(`/tasks/${task.id}/comments`, { body }))) setBody('');
    setSending(false);
  };

  return (
    <Box>
      <Stack spacing={2} sx={{ mb: 2 }}>
        {comments.map((c) => (
          <Stack key={c.id} direction="row" spacing={1.5}>
            <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: c.user_role === 'admin' ? 'secondary.main' : 'primary.main' }}>
              {initials(c.user_name ?? '?')}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography variant="body2" fontWeight={600}>{c.user_name ?? 'Deleted user'}</Typography>
                {c.user_role === 'admin' && <Chip size="small" label="admin" sx={{ height: 18, fontSize: 11 }} />}
                <Tooltip title={formatDateTime(c.created_at)}>
                  <Typography variant="caption" color="text.secondary">{timeAgo(c.created_at)}{c.edited_at ? ' · edited' : ''}</Typography>
                </Tooltip>
              </Stack>
              {c.deleted_at ? (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>This comment was deleted</Typography>
              ) : editing?.id === c.id ? (
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  <TextField size="small" multiline minRows={2} autoFocus value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" disabled={!editing.body.trim()} onClick={async () => {
                      if (await run(() => api.patch(`/tasks/${task.id}/comments/${c.id}`, { body: editing.body }))) setEditing(null);
                    }}>Save</Button>
                    <Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
                  </Stack>
                </Stack>
              ) : (
                <Paper variant="outlined" sx={{ p: 1.25, mt: 0.5, bgcolor: c.user_id === user.id ? 'action.hover' : undefined }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</Typography>
                </Paper>
              )}
              {!c.deleted_at && editing?.id !== c.id && (c.user_id === user.id || user.role === 'admin') && (
                <Stack direction="row" spacing={1} sx={{ mt: 0.25 }}>
                  {c.user_id === user.id && (
                    <Button size="small" sx={{ minWidth: 0, p: 0, fontSize: 12 }} onClick={() => setEditing({ id: c.id, body: c.body })}>Edit</Button>
                  )}
                  <Button size="small" color="error" sx={{ minWidth: 0, p: 0, fontSize: 12 }} onClick={() => setDeleting(c)}>Delete</Button>
                </Stack>
              )}
            </Box>
          </Stack>
        ))}
        {!comments.length && <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No comments yet. Start the discussion.</Typography>}
      </Stack>
      <Stack component="form" onSubmit={send} direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <TextField size="small" fullWidth multiline maxRows={6} placeholder="Write a comment… (Ctrl+Enter to send)"
          value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }} />
        <Button type="submit" variant="contained" endIcon={<SendIcon />} disabled={!body.trim() || sending}>Send</Button>
      </Stack>
      <ConfirmDialog open={!!deleting} title="Delete comment" confirmLabel="Delete"
        message="Delete this comment? It will show as “This comment was deleted” in the thread."
        onCancel={() => setDeleting(null)}
        onConfirm={() => { run(() => api.delete(`/tasks/${task.id}/comments/${deleting.id}`)); setDeleting(null); }} />
    </Box>
  );
}

function HistoryTab({ task }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get(`/tasks/${task.id}/activity`).then((r) => setItems(r.data)); }, [task]);
  if (!items) return null;
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No history yet. Changes made from now on will appear here.</Typography>;
  }
  return (
    <List dense disablePadding>
      {items.map((a) => (
        <ListItem key={a.id} disableGutters sx={{ alignItems: 'flex-start', borderLeft: 2, borderColor: 'divider', pl: 2, ml: 1 }}>
          <ListItemText
            primary={<><b>{a.user_name ?? 'Someone'}</b> {a.message}</>}
            secondary={`${formatDateTime(a.created_at)} · ${timeAgo(a.created_at)}`}
            slotProps={{ primary: { sx: { wordBreak: 'break-word' } } }} />
        </ListItem>
      ))}
    </List>
  );
}

// Completion remarks: shown on completed tasks; the assignee or an admin can add/edit them
function RemarksBox({ task, canEdit, onChanged, notify }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  if (task.status !== 'completed') return null;
  const save = async () => {
    try {
      await api.patch(`/tasks/${task.id}/remarks`, { remarks: text });
      notify('Remarks saved');
      setEditing(false);
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };
  return (
    <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, borderColor: 'success.light', bgcolor: (t) => `${t.palette.success.main}0a` }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" fontWeight={600} color="success.main">Completion remarks</Typography>
        {canEdit && !editing && (
          <Button size="small" onClick={() => { setText(task.completion_remarks ?? ''); setEditing(true); }}>
            {task.completion_remarks ? 'Edit' : 'Add remarks'}
          </Button>
        )}
      </Stack>
      {editing ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <TextField size="small" multiline minRows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)}
            placeholder="What was done, how it was tested, anything the team should know…" />
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={save}>Save</Button>
            <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
          </Stack>
        </Stack>
      ) : (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }} color={task.completion_remarks ? 'text.primary' : 'text.secondary'}>
          {task.completion_remarks || 'No remarks yet.'}
        </Typography>
      )}
    </Paper>
  );
}

export default function TaskDetailDialog({ task, tab, onTabChange, isAdmin, canEdit, onClose, onChanged, notify }) {
  const { user } = useAuth();
  if (!task) return null;
  const status = byValue(STATUSES, task.status);
  const closed = ['completed', 'rejected'].includes(task.status);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div">{task.title}</Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip size="small" label={status.label} color={status.color} variant="outlined" />
          <Typography variant="body2" color="text.secondary">
            {task.project_name}{task.client_name ? ` · ${task.client_name}` : ''}{task.developer_name ? ` · ${task.developer_name}` : ''}
          </Typography>
        </Stack>
        {(task.created_by_name || task.provided_by) && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {task.provided_by && <>Provided by <b>{task.provided_by}</b>{task.created_by_name ? ' · ' : ''}</>}
            {task.created_by_name && <>Created by {task.created_by_name}{task.created_by_role && task.created_by_role !== 'developer' ? ` (${ROLE_LABELS[task.created_by_role]})` : ''}</>}
          </Typography>
        )}
        {task.description && <Typography variant="body2" sx={{ mt: 1 }}>{task.description}</Typography>}
        <RequestBanner task={task} user={user} onChanged={onChanged} notify={notify} />
        <RemarksBox task={task} canEdit={canEdit} onChanged={onChanged} notify={notify} />
        {!canEdit && task.request_developer_id !== user.id && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {isStaffRole(user.role)
              ? <>Status, time and subtasks are handled by {task.developer_name ?? 'the assigned developer'}. You can edit the details (Edit in the list), comment and attach files.</>
              : <>View only — {task.developer_name ? `assigned to ${task.developer_name}` : 'assign this task to make changes'}. You can still comment and attach files.</>}
          </Alert>
        )}
      </DialogTitle>
      <Tabs value={tab} onChange={(e, v) => onTabChange(v)} variant="scrollable" allowScrollButtonsMobile sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="comments" label={`Comments${task.comment_count ? ` (${task.comment_count})` : ''}`} />
        <Tab value="files" label={`Files${task.attachment_count ? ` (${task.attachment_count})` : ''}`} />
        <Tab value="subtasks" label={`Subtasks (${task.subtask_done}/${task.subtask_total})`} />
        <Tab value="time" label="Time log" />
        <Tab value="history" label="History" />
      </Tabs>
      <DialogContent sx={{ minHeight: 320 }}>
        {tab === 'comments' && <CommentsTab task={task} onChanged={onChanged} notify={notify} />}
        {tab === 'files' && <FilesTab task={task} onChanged={onChanged} notify={notify} />}
        {tab === 'subtasks' && (
          <SubtasksTab task={task} editable={canEdit && (isAdmin || !closed)} onChanged={onChanged} notify={notify} />
        )}
        {tab === 'time' && (
          <TimeLogTab task={task} isAdmin={isAdmin} editable={canEdit && (isAdmin || task.status !== 'rejected')}
            canStart={canEdit && (isAdmin || !closed)} onChanged={onChanged} notify={notify} />
        )}
        {tab === 'history' && <HistoryTab task={task} />}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Tooltip title="Task summary (created time, estimate, time logged…) as a text file">
          <Button startIcon={<DescriptionOutlinedIcon />} onClick={() => downloadTask(task, user).catch((err) => notify(errorMessage(err), 'error'))}>
            Download (.txt)
          </Button>
        </Tooltip>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
