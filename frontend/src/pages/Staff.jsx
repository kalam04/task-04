import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, MenuItem, Paper, Snackbar,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client';
import { ROLE_LABELS, errorMessage } from '../components/constants';
import ConfirmDialog from '../components/ConfirmDialog';

const ROLES = ['marketing', 'support'];

function MemberDialog({ open, member, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'marketing' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm({ name: member?.name ?? '', username: member?.username ?? '', password: '', role: member?.role ?? 'marketing' });
      setError('');
    }
  }, [open, member]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try {
      if (member) await api.put(`/staff/${member.id}`, form);
      else await api.post('/staff', form);
      onSaved(member ? 'Team member updated' : 'Team member added');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={save}>
        <DialogTitle>{member ? 'Edit team member' : 'New Marketing / Support member'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {!member && (
            <Alert severity="info" sx={{ mb: 2 }}>
              They can see every task, create tasks, edit task details, comment, attach files, and ask a developer to take a task.
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Team" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
            </TextField>
            <TextField label="Full name" required autoFocus value={form.name} onChange={set('name')} />
            <TextField label="Username" required value={form.username} onChange={set('username')} autoComplete="off" helperText="Used to sign in" />
            <TextField label={member ? 'New password (leave blank to keep)' : 'Password'} type="password" required={!member}
              value={form.password} onChange={set('password')} autoComplete="new-password"
              helperText="At least 8 characters. They can change it later from their name menu." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">Save</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function Staff() {
  const [members, setMembers] = useState([]);
  const [dialog, setDialog] = useState(null); // { member? }
  const [deleting, setDeleting] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api.get('/staff').then((r) => setMembers(r.data)), []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    try {
      await api.delete(`/staff/${deleting.id}`);
      setToast({ message: 'Moved to Trash', severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
    setDeleting(null);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Marketing &amp; Support</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>New Member</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Team</TableCell><TableCell>Username</TableCell>
              <TableCell align="right">Tasks created</TableCell><TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id} hover>
                <TableCell>{m.name}</TableCell>
                <TableCell><Chip size="small" variant="outlined" label={ROLE_LABELS[m.role]} color={m.role === 'marketing' ? 'secondary' : 'info'} /></TableCell>
                <TableCell>{m.username}</TableCell>
                <TableCell align="right">
                  {m.tasks_created ? <Link component={RouterLink} to={`/tasks?created_by=${m.id}`}>{m.tasks_created}</Link> : 0}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog({ member: m })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(m)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {!members.length && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>No Marketing or Support members yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <MemberDialog open={!!dialog} member={dialog?.member} onClose={() => setDialog(null)}
        onSaved={(message) => { setDialog(null); setToast({ message, severity: 'success' }); load(); }} />
      <ConfirmDialog open={!!deleting} title="Delete team member"
        message={`Move "${deleting?.name}" to Trash? They won't be able to sign in until restored. Tasks they created stay.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
