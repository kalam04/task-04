import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Dialog, Link, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Snackbar,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client';
import { errorMessage } from '../components/constants';
import ConfirmDialog from '../components/ConfirmDialog';

function DeveloperDialog({ open, developer, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm({ name: developer?.name ?? '', username: developer?.username ?? '', password: '' });
      setError('');
    }
  }, [open, developer]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    try {
      if (developer) await api.put(`/developers/${developer.id}`, form);
      else await api.post('/developers', form);
      onSaved(developer ? 'Developer updated' : 'Developer added');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{developer ? 'Edit Developer' : 'New Developer'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Full name" required autoFocus value={form.name} onChange={set('name')} />
          <TextField label="Username" required value={form.username} onChange={set('username')}
            helperText="The developer signs in with this" />
          <TextField label={developer ? 'New password (leave blank to keep)' : 'Password'} type="password"
            required={!developer} value={form.password} onChange={set('password')} helperText="At least 6 characters" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function TaskCountLink({ developer, status, count }) {
  if (!count) return <Typography variant="body2" color="text.secondary">0</Typography>;
  return (
    <Link component={RouterLink} to={`/tasks?developer_id=${developer.id}&status=${status}`} fontWeight={600}
      title={`Show ${developer.name}'s ${status} tasks`}>
      {count}
    </Link>
  );
}

export default function Developers() {
  const [developers, setDevelopers] = useState([]);
  const [dialog, setDialog] = useState(null); // { developer? }
  const [deleting, setDeleting] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api.get('/developers').then((r) => setDevelopers(r.data)), []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    try {
      await api.delete(`/developers/${deleting.id}`);
      setToast({ message: 'Developer moved to Trash', severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
    setDeleting(null);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Developers</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>New Developer</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Username</TableCell>
              <TableCell align="right">Open tasks</TableCell><TableCell align="right">Completed</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {developers.map((d) => (
              <TableRow key={d.id} hover>
                <TableCell>{d.name}</TableCell>
                <TableCell>{d.username}</TableCell>
                <TableCell align="right"><TaskCountLink developer={d} status="open" count={d.open_tasks} /></TableCell>
                <TableCell align="right"><TaskCountLink developer={d} status="completed" count={d.completed_tasks} /></TableCell>
                <TableCell align="right">
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog({ developer: d })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(d)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {!developers.length && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>No developers yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <DeveloperDialog open={!!dialog} developer={dialog?.developer} onClose={() => setDialog(null)}
        onSaved={(message) => { setDialog(null); setToast({ message, severity: 'success' }); load(); }} />
      <ConfirmDialog open={!!deleting} title="Delete developer"
        message={`Move "${deleting?.name}" to Trash? They won't be able to sign in until restored. Their tasks stay assigned to them.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
