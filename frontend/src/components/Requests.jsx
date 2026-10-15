import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { api } from '../api/client';
import { errorMessage, timeAgo } from './constants';

// Marketing/Support (or an admin) ask a developer to take an unassigned task
export function RequestDeveloperDialog({ task, developers, onClose, onDone }) {
  const [developerId, setDeveloperId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setDeveloperId(''); setMessage(''); setError(''); }, [task]);

  const send = async () => {
    try {
      await api.post('/assignment-requests', { task_id: task.id, developer_id: developerId, message });
      onDone('Request sent. The developer can accept or decline.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={!!task} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Request a developer</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{task?.title}</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2}>
          <TextField select label="Developer" value={developerId} onChange={(e) => setDeveloperId(e.target.value)} autoFocus>
            {developers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name} ({d.username})</MenuItem>)}
          </TextField>
          <TextField label="Note for the developer (optional)" multiline minRows={2} value={message}
            onChange={(e) => setMessage(e.target.value)} placeholder="Why them, deadline, context…" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!developerId} onClick={send}>Send request</Button>
      </DialogActions>
    </Dialog>
  );
}

export function DeclineRequestDialog({ request, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [request]);
  return (
    <Dialog open={!!request} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Decline request</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{request?.title}</Typography>
        <TextField label="Reason" required multiline minRows={3} fullWidth autoFocus value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fully booked this week, try Nusrat" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="error" variant="contained" disabled={!reason.trim()} onClick={() => onConfirm(reason)}>Decline</Button>
      </DialogActions>
    </Dialog>
  );
}

// Accept / decline / cancel a request; returns a message for a toast
export async function respondToRequest(requestId, action, reason) {
  await api.post(`/assignment-requests/${requestId}/${action}`, action === 'decline' ? { reason } : {});
  return { accept: 'Task accepted — it is now assigned to you', decline: 'Request declined', cancel: 'Request cancelled' }[action];
}

// Shown on a task with a pending request (task dialog)
export function RequestBanner({ task, user, onChanged, notify }) {
  const [declining, setDeclining] = useState(null);
  if (!task.request_id) return null;
  const forMe = task.request_developer_id === user.id;
  const canCancel = task.request_by_id === user.id || user.role === 'admin';
  const act = async (action, reason) => {
    try {
      notify(await respondToRequest(task.request_id, action, reason));
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };
  return (
    <Alert severity={forMe ? 'warning' : 'info'} icon={<HowToRegIcon />} sx={{ mt: 1.5 }}
      action={forMe ? (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" color="success" onClick={() => act('accept')}>Accept</Button>
          <Button size="small" color="error" onClick={() => setDeclining({ title: task.title })}>Decline</Button>
        </Stack>
      ) : canCancel ? <Button size="small" color="inherit" onClick={() => act('cancel')}>Cancel request</Button> : null}>
      {forMe
        ? <><b>{task.request_by_name}</b> asked you to take this task</>
        : <>Waiting for <b>{task.request_developer_name}</b> to accept · requested by {task.request_by_name}</>}
      {' '}· {timeAgo(task.request_created_at)}
      {task.request_message && <Typography variant="body2" sx={{ mt: 0.5, fontStyle: 'italic' }}>“{task.request_message}”</Typography>}
      <DeclineRequestDialog request={declining} onClose={() => setDeclining(null)}
        onConfirm={(reason) => { setDeclining(null); act('decline', reason); }} />
    </Alert>
  );
}
