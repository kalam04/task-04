import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, LinearProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Grid, IconButton, ListItemIcon, Menu, MenuItem, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import ScheduleIcon from '@mui/icons-material/Schedule';
import StopIcon from '@mui/icons-material/Stop';
import ChecklistIcon from '@mui/icons-material/Checklist';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt1';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PRIORITIES, STATUSES, byValue, dueState, errorMessage, formatDuration, formatEstimate, isStaffRole } from '../components/constants';
import TaskDetailDialog from '../components/TaskDetailDialog';
import { DeclineRequestDialog, RequestDeveloperDialog, respondToRequest } from '../components/Requests';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { FileDropZone, PendingFiles, formatBytes, uploadFiles } from '../components/Attachments';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import useNow, { totalMs } from '../components/useNow';
import ConfirmDialog from '../components/ConfirmDialog';

const emptyTask = { title: '', description: '', project_id: '', client_id: '', developer_id: '', priority: 'medium', due_date: '', provided_by: '' };

// Developers create tasks too (assigned to themselves by default); when editing they can't reassign
function TaskFormDialog({ open, task, projects, developers, isAdmin, isStaff, userId, onClose, onSaved }) {
  const [form, setForm] = useState(emptyTask);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState([]); // [{ file, voice }] uploaded after the task is created
  const [providerNames, setProviderNames] = useState([]); // earlier "provided by" names, as suggestions
  const [uploading, setUploading] = useState(null); // percent while uploading

  useEffect(() => {
    if (!open) return;
    setError('');
    setPending([]);
    setUploading(null);
    api.get('/tasks/provided-by-names').then((r) => setProviderNames(r.data)).catch(() => {});
    setForm(task ? {
      ...emptyTask, ...Object.fromEntries(Object.keys(emptyTask).map((k) => [k, task[k] ?? ''])),
    } : { ...emptyTask, developer_id: isAdmin || isStaff ? '' : userId, request_developer_id: '', request_message: '' });
  }, [open, task, isAdmin, isStaff, userId]);

  useEffect(() => {
    if (!form.project_id) return setClients([]);
    api.get('/clients', { params: { project_id: form.project_id } }).then((r) => setClients(r.data));
  }, [form.project_id]);

  const set = (key) => (e) => setForm((f) => ({
    ...f, [key]: e.target.value, ...(key === 'project_id' ? { client_id: '' } : {}),
  }));

  const save = async () => {
    setError('');
    try {
      const payload = { ...form };
      for (const k of ['client_id', 'developer_id', 'due_date', 'request_developer_id']) if (!payload[k]) payload[k] = null;
      if (task) {
        await api.put(`/tasks/${task.id}`, payload);
        onSaved('Task updated');
        return;
      }
      const { data: created } = await api.post('/tasks', payload);
      if (created.request_error) setError(`Task created, but the developer request failed: ${created.request_error}`);
      // Then upload attachments: regular files together, each voice note on its own
      const files = pending.filter((p) => !p.voice).map((p) => p.file);
      const voices = pending.filter((p) => p.voice).map((p) => p.file);
      const batches = [...(files.length ? [{ files, voice: false }] : []), ...voices.map((v) => ({ files: [v], voice: true }))];
      try {
        for (const [i, b] of batches.entries()) {
          setUploading(Math.round((i / batches.length) * 100));
          await uploadFiles(created.id, b.files, {
            voice: b.voice, onProgress: (p) => setUploading(Math.round(((i + p / 100) / batches.length) * 100)),
          });
        }
      } catch (err) {
        onSaved(`Task created, but an attachment failed: ${errorMessage(err)}. Add it from the task's Files tab.`, 'warning');
        return;
      }
      onSaved(batches.length ? `Task created with ${pending.length} attachment${pending.length === 1 ? '' : 's'}` : 'Task created');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{task ? 'Edit Task' : 'New Task'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Title" required value={form.title} onChange={set('title')} autoFocus />
          <TextField label="Description" multiline minRows={3} value={form.description} onChange={set('description')} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Project" required fullWidth value={form.project_id} onChange={set('project_id')}>
              {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>
            <TextField select label="Client (optional)" fullWidth value={form.client_id} onChange={set('client_id')}
              disabled={!form.project_id} helperText={form.project_id && !clients.length ? 'No clients in this project' : ''}>
              <MenuItem value=""><em>None</em></MenuItem>
              {clients.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              {!!task?.client_deleted && task.project_id === form.project_id && (
                <MenuItem value={task.client_id}>{task.client_name} (deleted)</MenuItem>
              )}
            </TextField>
          </Stack>
          <Autocomplete freeSolo options={providerNames} value={form.provided_by ?? ''}
            onInputChange={(e, value) => setForm((f) => ({ ...f, provided_by: value }))}
            renderInput={(params) => (
              <TextField {...params} label="Task provided by (optional)"
                helperText="Who gave or asked for this task — any name, e.g. a client contact or manager" />
            )} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {isStaff && !task ? (
              <TextField select label="Request a developer (optional)" fullWidth value={form.request_developer_id ?? ''}
                onChange={set('request_developer_id')} helperText="They'll be asked to accept or decline">
                <MenuItem value=""><em>No request — leave unassigned</em></MenuItem>
                {developers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name} ({d.username})</MenuItem>)}
              </TextField>
            ) : (
            <TextField select label="Assign to developer" fullWidth value={form.developer_id} onChange={set('developer_id')}
              disabled={!isAdmin && !!task} helperText={!isAdmin && task ? 'Only an admin can reassign a task' : ' '}>
              <MenuItem value=""><em>Unassigned</em></MenuItem>
              {developers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name} ({d.username}){d.id === userId ? ' — you' : ''}</MenuItem>)}
              {!!task?.developer_deleted && <MenuItem value={task.developer_id}>{task.developer_name} (deleted)</MenuItem>}
            </TextField>
            )}
            <TextField select label="Priority" fullWidth value={form.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </TextField>
          </Stack>
          {isStaff && !task && form.request_developer_id && (
            <TextField label="Note for the developer (optional)" multiline minRows={2} value={form.request_message ?? ''}
              onChange={set('request_message')} placeholder="Why them, deadline, context…" />
          )}
          <TextField label="Due date" type="date" value={form.due_date} onChange={set('due_date')}
            slotProps={{ inputLabel: { shrink: true } }} />
          {!task && (
            <Box>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                Attachments {pending.length > 0 && `(${pending.length} · ${formatBytes(pending.reduce((s, p) => s + p.file.size, 0))})`}
              </Typography>
              <FileDropZone disabled={uploading != null}
                onFiles={(files, { voice }) => setPending((p) => [...p, ...files.map((file) => ({ file, voice }))])} />
              <PendingFiles files={pending} onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))} />
            </Box>
          )}
          {uploading != null && (
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>Uploading attachments… {uploading}%</Typography>
              <LinearProgress variant="determinate" value={uploading} />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={uploading != null}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={uploading != null}>{task ? 'Save' : 'Create'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function CompleteDialog({ task, onClose, onConfirm }) {
  const [remarks, setRemarks] = useState('');
  useEffect(() => setRemarks(''), [task]);
  return (
    <Dialog open={!!task} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Complete task</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{task?.title}</Typography>
        <TextField label="Remarks (optional)" multiline minRows={3} fullWidth autoFocus value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="What was done, how it was tested, anything the team should know…"
          helperText="You can also add or change remarks later from the task." />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="success" variant="contained" startIcon={<TaskAltIcon />} onClick={() => onConfirm(remarks)}>Mark complete</Button>
      </DialogActions>
    </Dialog>
  );
}

function RejectDialog({ task, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [task]);
  return (
    <Dialog open={!!task} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reject task</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{task?.title}</Typography>
        <TextField label="Reason" required multiline minRows={3} fullWidth autoFocus
          value={reason} onChange={(e) => setReason(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" disabled={!reason.trim()} onClick={() => onConfirm(reason)}>Reject</Button>
      </DialogActions>
    </Dialog>
  );
}

function EstimateDialog({ task, onClose, onSave }) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('hours');
  useEffect(() => {
    if (!task) return;
    setValue(task.estimate_value ?? '');
    setUnit(task.estimate_unit ?? 'hours');
  }, [task]);
  const valid = Number(value) > 0;
  return (
    <Dialog open={!!task} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Time estimate</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>How long will "{task?.title}" take to complete?</Typography>
        <Stack direction="row" spacing={2}>
          <TextField label="Amount" type="number" autoFocus fullWidth value={value}
            onChange={(e) => setValue(e.target.value)} slotProps={{ htmlInput: { min: 0.5, step: 0.5 } }} />
          <TextField select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} sx={{ minWidth: 120 }}>
            <MenuItem value="hours">Hours</MenuItem>
            <MenuItem value="days">Days</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        {task?.estimate_value != null && <Button color="error" onClick={() => onSave(null, null)} sx={{ mr: 'auto' }}>Clear</Button>}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid} onClick={() => onSave(Number(value), unit)}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function DueDate({ task }) {
  if (!task.due_date) return '—';
  const state = dueState(task);
  return (
    <Box>
      <Typography variant="body2" color={state?.kind === 'overdue' ? 'error' : undefined}
        fontWeight={state ? 600 : undefined}>{task.due_date}</Typography>
      {state?.kind === 'overdue' && (
        <Chip size="small" color="error" label={`${state.days} day${state.days === 1 ? '' : 's'} overdue`} sx={{ mt: 0.25, height: 20 }} />
      )}
      {state?.kind === 'today' && <Chip size="small" color="warning" label="Due today" sx={{ mt: 0.25, height: 20 }} />}
    </Box>
  );
}

function TimeTaken({ task, now }) {
  if (!task.time_entry_count) return <Typography variant="body2" color="text.secondary">Not started</Typography>;
  const slots = `${task.time_entry_count} time slot${task.time_entry_count === 1 ? '' : 's'}`;
  return (
    <Tooltip title={task.running_since ? `${slots} · timer running` : slots}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
        {task.running_since && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />}
        <Typography variant="body2" fontWeight={500} color={task.running_since ? 'primary' : undefined}>
          {formatDuration(totalMs(task, now))}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

function AssignDialog({ task, developers, defaultId, onClose, onSave }) {
  const [developerId, setDeveloperId] = useState('');
  useEffect(() => { if (task) setDeveloperId(defaultId ?? ''); }, [task, defaultId]);
  return (
    <Dialog open={!!task} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Assign task</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{task?.title}</Typography>
        <TextField select fullWidth label="Developer" value={developerId} onChange={(e) => setDeveloperId(e.target.value)}>
          {developers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name} ({d.username})</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!developerId} onClick={() => onSave(developerId)}>Assign</Button>
      </DialogActions>
    </Dialog>
  );
}

const FILTER_KEYS = ['q', 'project_id', 'developer_id', 'status', 'priority', 'created_by'];

export default function Tasks() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [developers, setDevelopers] = useState([]);
  // Filters live in the URL so other pages can link to a filtered list (e.g. a developer's open tasks)
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) ?? ''])), [searchParams]);
  const setFilters = (update) => {
    const next = typeof update === 'function' ? update(filters) : update;
    setSearchParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)), { replace: true });
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [estimating, setEstimating] = useState(null);
  // The open task dialog is in the URL too (?task=12&tab=comments), so notifications can link to it
  const detailId = Number(searchParams.get('task')) || null;
  const detail = detailId ? { id: detailId, tab: searchParams.get('tab') || 'comments' } : null;
  const setDetail = (next) => {
    const value = typeof next === 'function' ? next(detail) : next;
    const p = new URLSearchParams(searchParams);
    if (value) {
      p.set('task', value.id);
      p.set('tab', value.tab);
    } else {
      p.delete('task');
      p.delete('tab');
    }
    setSearchParams(p, { replace: true });
  };
  const [detailTask, setDetailTask] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [statusMenu, setStatusMenu] = useState(null);
  const [priorityMenu, setPriorityMenu] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [requesting, setRequesting] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [toast, setToast] = useState(null);

  const params = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), [filters]);
  // Everyone sees every task, but only the assignee (or an admin) can change it
  const canEdit = (t) => isAdmin || t.developer_id === user.id;
  const isStaff = isStaffRole(user.role);
  // Task details (title, description, priority, due date…): admins, Marketing/Support, and the assignee
  const canEditDetails = (t) => isAdmin || isStaff || (t.developer_id === user.id && !['completed', 'rejected'].includes(t.status));

  const anyRunning = tasks.some((t) => t.running_since);
  const now = useNow(anyRunning);

  const load = useCallback(() => {
    api.get('/tasks', { params }).then((r) => setTasks(r.data));
    // The open task may be outside the current filters, so fetch it on its own
    if (detailId) api.get(`/tasks/${detailId}`).then((r) => setDetailTask(r.data)).catch(() => setDetailTask(null));
    else setDetailTask(null);
    const { status: _status, ...scope } = params; // the status cards show counts for the other filters
    api.get('/tasks/stats', { params: scope }).then((r) => setStats(r.data));
  }, [params, detailId]);

  useEffect(() => { load(); }, [load]);

  // /tasks?new=1 (e.g. from My Dashboard) opens the New Task form
  useEffect(() => {
    if (!searchParams.get('new')) return;
    setEditing(null);
    setFormOpen(true);
    const p = new URLSearchParams(searchParams);
    p.delete('new');
    setSearchParams(p, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    api.get('/projects').then((r) => { setProjects(r.data); setProjectsLoaded(true); });
    api.get('/developers').then((r) => setDevelopers(r.data));
  }, []);

  const notify = (message, severity = 'success') => setToast({ message, severity });

  const changeStatus = async (task, status, reject_reason, remarks) => {
    try {
      await api.patch(`/tasks/${task.id}/status`, { status, reject_reason, remarks });
      notify(`Task marked ${byValue(STATUSES, status).label.toLowerCase()}`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const saveEstimate = async (estimate_value, estimate_unit) => {
    try {
      await api.patch(`/tasks/${estimating.id}/estimate`, { estimate_value, estimate_unit });
      notify(estimate_value == null ? 'Estimate cleared' : 'Estimate saved');
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setEstimating(null);
  };

  const timer = async (task, action) => {
    try {
      await api.post(`/tasks/${task.id}/timer/${action}`);
      notify(action === 'start' ? 'Timer started' : 'Timer stopped');
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  // Statuses the current user may move a task to (mirrors the server rules)
  const statusOptions = (t) => {
    if (isAdmin) return STATUSES.map((s) => s.value);
    if (!canEdit(t) || ['completed', 'rejected'].includes(t.status)) return [];
    return ['in_progress', 'completed', 'rejected'];
  };
  // Priority and estimate: admins always; the assignee while the task is still open
  const canEditEstimate = (t) => canEdit(t) && (isAdmin || !['completed', 'rejected'].includes(t.status));

  const changePriority = async (task, priority) => {
    try {
      await api.patch(`/tasks/${task.id}/priority`, { priority });
      notify(`Priority set to ${byValue(PRIORITIES, priority).label}`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  // A chip that opens a pop-up when the user is allowed to change it
  const editableChip = (props, onOpen, title) => (onOpen ? (
    <Tooltip title={title}>
      <Chip size="small" {...props} onClick={onOpen} onDelete={onOpen} deleteIcon={<ArrowDropDownIcon />}
        sx={{ cursor: 'pointer', '& .MuiChip-deleteIcon': { mr: 0.25, ml: -0.75 } }} />
    </Tooltip>
  ) : <Chip size="small" {...props} />);

  const requestAction = async (t, action, reason) => {
    try {
      notify(await respondToRequest(t.request_id, action, reason));
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const assign = async (developer_id) => {
    try {
      await api.patch(`/tasks/${assigning.id}/assign`, { developer_id });
      notify('Task assigned');
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setAssigning(null);
  };

  const deleteTask = async () => {
    try {
      await api.delete(`/tasks/${deleting.id}`);
      notify('Task moved to Trash');
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setDeleting(null);
  };

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  const detailButtons = (t) => (
    <>
      <Tooltip title="Subtasks"><IconButton size="small" onClick={() => setDetail({ id: t.id, tab: 'subtasks' })}><ChecklistIcon /></IconButton></Tooltip>
      <Tooltip title="Time log"><IconButton size="small" onClick={() => setDetail({ id: t.id, tab: 'time' })}><ScheduleIcon /></IconButton></Tooltip>
    </>
  );

  const timerButton = (t) => (t.running_since ? (
    <Tooltip title="Stop timer"><IconButton size="small" color="error" onClick={() => timer(t, 'stop')}><StopIcon /></IconButton></Tooltip>
  ) : (
    <Tooltip title={t.status === 'pending' ? 'Start working (starts timer)' : 'Start timer'}>
      <IconButton size="small" color="primary" onClick={() => timer(t, 'start')}><PlayArrowIcon /></IconButton>
    </Tooltip>
  ));

  const assignButton = (t) => (
    <Tooltip title="Assign to a developer">
      <IconButton size="small" color="primary" onClick={() => setAssigning(t)}><PersonAddIcon /></IconButton>
    </Tooltip>
  );

  // A request waiting for me: accept or decline right from the row
  const requestButtons = (t) => (
    <>
      <Tooltip title="Accept — assign it to me"><IconButton size="small" color="success" onClick={() => requestAction(t, 'accept')}><HowToRegIcon /></IconButton></Tooltip>
      <Tooltip title="Decline request"><IconButton size="small" color="error" onClick={() => setDeclining(t)}><CancelIcon /></IconButton></Tooltip>
    </>
  );

  // Someone else's task: view only
  const viewActions = (t) => (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
      {t.request_developer_id === user.id && requestButtons(t)}
      {!t.developer_id && !t.request_id && assignButton(t)}
      {detailButtons(t)}
    </Stack>
  );

  // Marketing / Support: request a developer, edit details, discuss
  const staffActions = (t) => (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
      {!t.developer_id && !t.request_id && ['pending', 'in_progress'].includes(t.status) && (
        <Tooltip title="Request a developer"><IconButton size="small" color="primary" onClick={() => setRequesting(t)}><PersonSearchIcon /></IconButton></Tooltip>
      )}
      {detailButtons(t)}
      <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditing(t); setFormOpen(true); }}><EditIcon /></IconButton></Tooltip>
    </Stack>
  );

  const devActions = (t) => {
    if (!canEdit(t)) return viewActions(t);
    if (['completed', 'rejected'].includes(t.status)) {
      return <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>{detailButtons(t)}</Stack>;
    }
    return (
      <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
        {timerButton(t)}
        {detailButtons(t)}
        <Tooltip title="Set time estimate"><IconButton size="small" onClick={() => setEstimating(t)}><TimerOutlinedIcon /></IconButton></Tooltip>
        <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditing(t); setFormOpen(true); }}><EditIcon /></IconButton></Tooltip>
        <Tooltip title="Mark complete"><IconButton size="small" color="success" onClick={() => setCompleting(t)}><CheckCircleIcon /></IconButton></Tooltip>
        <Tooltip title="Reject"><IconButton size="small" color="error" onClick={() => setRejecting(t)}><CancelIcon /></IconButton></Tooltip>
      </Stack>
    );
  };

  const adminActions = (t) => (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
      {!t.developer_id && !t.request_id && assignButton(t)}
      {t.running_since && timerButton(t)}
      {detailButtons(t)}
      <Tooltip title="Set time estimate"><IconButton size="small" onClick={() => setEstimating(t)}><TimerOutlinedIcon /></IconButton></Tooltip>
      <Tooltip title="Change status"><IconButton size="small" onClick={(e) => setStatusMenu({ anchor: e.currentTarget, task: t })}><MoreVertIcon /></IconButton></Tooltip>
      <Tooltip title="Edit"><IconButton size="small" onClick={() => { setEditing(t); setFormOpen(true); }}><EditIcon /></IconButton></Tooltip>
      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(t)}><DeleteIcon /></IconButton></Tooltip>
    </Stack>
  );

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Tasks</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditing(null); setFormOpen(true); }}
          disabled={!projects.length}>New Task</Button>
      </Stack>

      {projectsLoaded && !projects.length && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {isAdmin ? 'Create a project first (Projects & Clients), then add tasks.' : 'There are no projects yet. Ask an admin to create one before adding tasks.'}
        </Alert>
      )}

      {isStaff && (
        <ToggleButtonGroup exclusive size="small" color="primary" sx={{ mb: 2 }}
          value={filters.created_by === String(user.id) ? 'mine' : filters.developer_id === 'none' ? 'none' : 'all'}
          onChange={(e, v) => v && setFilters((f) => ({
            ...f, created_by: v === 'mine' ? String(user.id) : '', developer_id: v === 'none' ? 'none' : '',
          }))}>
          <ToggleButton value="mine">Created by me</ToggleButton>
          <ToggleButton value="all">All tasks</ToggleButton>
          <ToggleButton value="none">Unassigned</ToggleButton>
        </ToggleButtonGroup>
      )}

      {user.role === 'developer' && (
        <ToggleButtonGroup exclusive size="small" color="primary" sx={{ mb: 2 }}
          value={filters.developer_id === String(user.id) ? 'mine' : filters.developer_id === 'none' ? 'none' : filters.developer_id ? 'other' : 'all'}
          onChange={(e, v) => v && v !== 'other' && setFilters((f) => ({ ...f, developer_id: v === 'mine' ? String(user.id) : v === 'none' ? 'none' : '' }))}>
          <ToggleButton value="mine">My tasks</ToggleButton>
          <ToggleButton value="all">All tasks</ToggleButton>
          <ToggleButton value="none">Unassigned</ToggleButton>
        </ToggleButtonGroup>
      )}

      {stats && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {STATUSES.map((s) => (
            <Grid key={s.value} size={{ xs: 6, md: 3 }}>
              <Card variant="outlined" sx={{ cursor: 'pointer', borderColor: filters.status === s.value ? 'primary.main' : undefined }}
                onClick={() => setFilters((f) => ({ ...f, status: f.status === s.value ? '' : s.value }))}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="body2" color="text.secondary">{s.label}</Typography>
                  <Typography variant="h5" fontWeight={600}>{stats[s.value]}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField size="small" label="Search" value={filters.q} onChange={setFilter('q')} sx={{ flex: 2 }} />
          <TextField size="small" select label="Project" value={filters.project_id} onChange={setFilter('project_id')} sx={{ flex: 1 }}>
            <MenuItem value="">All</MenuItem>
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Developer" value={filters.developer_id} onChange={setFilter('developer_id')} sx={{ flex: 1 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="none"><em>Unassigned</em></MenuItem>
            {developers.map((d) => <MenuItem key={d.id} value={String(d.id)}>{d.name}{d.id === user.id ? ' (you)' : ''}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Status" value={filters.status} onChange={setFilter('status')} sx={{ flex: 1 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="open">Open (Pending + In Progress)</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Priority" value={filters.priority} onChange={setFilter('priority')} sx={{ flex: 1 }}>
            <MenuItem value="">All</MenuItem>
            {PRIORITIES.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
          </TextField>
          {hasFilters && <Button onClick={() => setFilters({})} sx={{ flexShrink: 0 }}>Clear</Button>}
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" sx={{ '& th, & td': { whiteSpace: 'nowrap' } }}>
          <TableHead>
            <TableRow>
              <TableCell>Task</TableCell>
              <TableCell>Project / Client</TableCell>
              <TableCell>Developer</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Estimate</TableCell>
              <TableCell>Time taken</TableCell>
              <TableCell>Due</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((t) => {
              const priority = byValue(PRIORITIES, t.priority);
              const status = byValue(STATUSES, t.status);
              return (
                <TableRow key={t.id} hover sx={dueState(t)?.kind === 'overdue' ? { bgcolor: (th) => `${th.palette.error.main}0d` } : undefined}>
                  <TableCell sx={{ minWidth: 200, maxWidth: 320, whiteSpace: 'normal !important' }}>
                    <Typography fontWeight={500} sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                      onClick={() => setDetail({ id: t.id, tab: 'comments' })}>{t.title}</Typography>
                    {t.description && <Typography variant="body2" color="text.secondary" noWrap>{t.description}</Typography>}
                    {t.provided_by && (
                      <Typography variant="caption" color="text.secondary" component="div" noWrap>Provided by <b>{t.provided_by}</b></Typography>
                    )}
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                      {!!t.subtask_total && (
                        <Chip size="small" variant="outlined" icon={<ChecklistIcon />}
                          color={t.subtask_done === t.subtask_total ? 'success' : 'default'}
                          label={`${t.subtask_done}/${t.subtask_total} subtasks`}
                          onClick={() => setDetail({ id: t.id, tab: 'subtasks' })} />
                      )}
                      {!!t.attachment_count && (
                        <Chip size="small" variant="outlined" icon={<AttachFileIcon />} label={t.attachment_count}
                          onClick={() => setDetail({ id: t.id, tab: 'files' })} />
                      )}
                      {!!t.comment_count && (
                        <Chip size="small" variant="outlined" icon={<ChatBubbleOutlineIcon />} label={t.comment_count}
                          onClick={() => setDetail({ id: t.id, tab: 'comments' })} />
                      )}
                    </Stack>
                    {t.status === 'rejected' && t.reject_reason && (
                      <Typography variant="body2" color="error">Reason: {t.reject_reason}</Typography>
                    )}
                    {t.status === 'completed' && t.completion_remarks && (
                      <Typography variant="body2" color="success.main" noWrap title={t.completion_remarks}>Remarks: {t.completion_remarks}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{t.project_name}</Typography>
                    <Typography variant="body2" color="text.secondary">{t.client_name ? `${t.client_name}${t.client_deleted ? ' (deleted)' : ''}` : '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    {t.developer_name ? (
                      <Typography variant="body2" fontWeight={t.developer_id === user.id ? 600 : undefined}>
                        {t.developer_name}{t.developer_deleted ? ' (deleted)' : ''}{t.developer_id === user.id ? ' (you)' : ''}
                      </Typography>
                    ) : t.request_id ? (
                      <Tooltip title={`Requested by ${t.request_by_name}${t.request_message ? `: “${t.request_message}”` : ''}`}>
                        <Chip size="small" icon={<HowToRegIcon />} variant="outlined"
                          color={t.request_developer_id === user.id ? 'warning' : 'info'}
                          label={t.request_developer_id === user.id ? 'Asked you' : `Asked ${t.request_developer_name}`} />
                      </Tooltip>
                    ) : <Chip size="small" label="Unassigned" variant="outlined" color="warning" />}
                  </TableCell>
                  <TableCell>
                    {editableChip({ label: priority.label, color: priority.color },
                      canEditDetails(t) ? (e) => setPriorityMenu({ anchor: e.currentTarget, task: t }) : null, 'Change priority')}
                  </TableCell>
                  <TableCell>
                    {editableChip({ label: status.label, color: status.color, variant: 'outlined' },
                      statusOptions(t).length ? (e) => setStatusMenu({ anchor: e.currentTarget, task: t }) : null, 'Change status')}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {canEditEstimate(t) ? (
                      <Tooltip title="Change estimate">
                        <Button size="small" onClick={() => setEstimating(t)} endIcon={<ArrowDropDownIcon />}
                          sx={{ textTransform: 'none', ml: -1, color: formatEstimate(t) ? 'text.primary' : 'text.secondary', fontWeight: 400 }}>
                          {formatEstimate(t) || 'Set estimate'}
                        </Button>
                      </Tooltip>
                    ) : formatEstimate(t) || <Typography variant="body2" color="text.secondary">Not set</Typography>}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}><TimeTaken task={t} now={now} /></TableCell>
                  <TableCell><DueDate task={t} /></TableCell>
                  <TableCell align="right">{isAdmin ? adminActions(t) : isStaff ? staffActions(t) : devActions(t)}</TableCell>
                </TableRow>
              );
            })}
            {!tasks.length && (
              <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>No tasks found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={statusMenu?.anchor} open={!!statusMenu} onClose={() => setStatusMenu(null)}>
        <MenuItem disabled sx={{ fontSize: 12, opacity: '1 !important', color: 'text.secondary' }}>Change status</MenuItem>
        {statusMenu && STATUSES.filter((s) => s.value === statusMenu.task.status || statusOptions(statusMenu.task).includes(s.value)).map((s) => {
          const current = statusMenu.task.status === s.value;
          return (
            <MenuItem key={s.value} disabled={current} onClick={() => {
              const task = statusMenu.task;
              setStatusMenu(null);
              if (s.value === 'rejected') setRejecting(task);
              else if (s.value === 'completed') setCompleting(task);
              else changeStatus(task, s.value);
            }}>
              <ListItemIcon>{current && <CheckIcon fontSize="small" />}</ListItemIcon>
              <Chip size="small" variant="outlined" color={s.color} sx={{ cursor: 'inherit' }}
                label={s.value === 'pending' && !current ? 'Reopen (Pending)' : s.label} />
            </MenuItem>
          );
        })}
      </Menu>

      <Menu anchorEl={priorityMenu?.anchor} open={!!priorityMenu} onClose={() => setPriorityMenu(null)}>
        <MenuItem disabled sx={{ fontSize: 12, opacity: '1 !important', color: 'text.secondary' }}>Change priority</MenuItem>
        {priorityMenu && [...PRIORITIES].reverse().map((p) => {
          const current = priorityMenu.task.priority === p.value;
          return (
            <MenuItem key={p.value} disabled={current} onClick={() => {
              const task = priorityMenu.task;
              setPriorityMenu(null);
              changePriority(task, p.value);
            }}>
              <ListItemIcon>{current && <CheckIcon fontSize="small" />}</ListItemIcon>
              <Chip size="small" color={p.color} label={p.label} sx={{ cursor: 'inherit' }} />
            </MenuItem>
          );
        })}
      </Menu>

      <RequestDeveloperDialog task={requesting} developers={developers} onClose={() => setRequesting(null)}
        onDone={(msg) => { setRequesting(null); notify(msg); load(); }} />
      <DeclineRequestDialog request={declining} onClose={() => setDeclining(null)}
        onConfirm={(reason) => { requestAction(declining, 'decline', reason); setDeclining(null); }} />
      <TaskFormDialog open={formOpen} task={editing} projects={projects} developers={developers} isAdmin={isAdmin} isStaff={isStaff} userId={user.id}
        onClose={() => setFormOpen(false)} onSaved={(msg, severity) => { setFormOpen(false); notify(msg, severity); load(); }} />
      <CompleteDialog task={completing} onClose={() => setCompleting(null)}
        onConfirm={(remarks) => { changeStatus(completing, 'completed', undefined, remarks); setCompleting(null); }} />
      <RejectDialog task={rejecting} onClose={() => setRejecting(null)}
        onConfirm={(reason) => { changeStatus(rejecting, 'rejected', reason); setRejecting(null); }} />
      <AssignDialog task={assigning} developers={developers} defaultId={isAdmin ? '' : user.id}
        onClose={() => setAssigning(null)} onSave={assign} />
      <TaskDetailDialog task={detail && detailTask?.id === detail.id ? detailTask : null} tab={detail?.tab}
        onTabChange={(tab) => setDetail((d) => ({ ...d, tab }))}
        isAdmin={isAdmin} canEdit={detailTask ? canEdit(detailTask) : false} onClose={() => setDetail(null)} onChanged={load} notify={notify} />
      <EstimateDialog task={estimating} onClose={() => setEstimating(null)} onSave={saveEstimate} />
      <ConfirmDialog open={!!deleting} title="Delete task" message={`Move "${deleting?.title}" to Trash? You can restore it from the Trash page.`}
        onCancel={() => setDeleting(null)} onConfirm={deleteTask} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
