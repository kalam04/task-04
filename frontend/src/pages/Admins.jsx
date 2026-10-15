import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Snackbar,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client';
import { errorMessage, formatDateTime } from '../components/constants';
import ConfirmDialog from '../components/ConfirmDialog';

function AdminDialog({ open, admin, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm({ name: admin?.name ?? '', username: admin?.username ?? '', password: '' });
      setError('');
    }
  }, [open, admin]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    try {
      if (admin) await api.put(`/admins/${admin.id}`, form);
      else await api.post('/admins', form);
      onSaved(admin ? 'Admin updated' : 'Admin added');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={save}>
        <DialogTitle>{admin ? 'Edit Admin' : 'New Admin'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {!admin && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Admins have full access: tasks, projects, clients, developers, reports, Trash and other admins.
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Full name" required autoFocus value={form.name} onChange={set('name')} />
            <TextField label="Username" required value={form.username} onChange={set('username')}
              helperText="Used to sign in" autoComplete="off" />
            <TextField label={admin ? 'New password (leave blank to keep)' : 'Password'} type="password"
              required={!admin} value={form.password} onChange={set('password')} autoComplete="new-password"
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

export default function Admins() {
  const [admins, setAdmins] = useState([]);
  const [dialog, setDialog] = useState(null); // { admin? }
  const [deleting, setDeleting] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api.get('/admins').then((r) => setAdmins(r.data)), []);
  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    try {
      await api.delete(`/admins/${deleting.id}`);
      setToast({ message: 'Admin moved to Trash', severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
    setDeleting(null);
  };

  const onlyOne = admins.length <= 1;

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Admins</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>New Admin</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Username</TableCell><TableCell>Added</TableCell><TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {admins.map((a) => {
              const cantDelete = a.is_you ? "You can't delete your own account" : onlyOne ? 'There must be at least one admin' : '';
              return (
                <TableRow key={a.id} hover>
                  <TableCell>
                    {a.name}
                    {a.is_you && <Chip size="small" label="you" sx={{ ml: 1, height: 20 }} />}
                  </TableCell>
                  <TableCell>{a.username}</TableCell>
                  <TableCell>{formatDateTime(a.created_at?.includes('T') ? a.created_at : `${a.created_at?.replace(' ', 'T')}Z`)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog({ admin: a })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title={cantDelete || 'Delete'}>
                      <span>
                        <IconButton size="small" color="error" disabled={!!cantDelete} onClick={() => setDeleting(a)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <AdminDialog open={!!dialog} admin={dialog?.admin} onClose={() => setDialog(null)}
        onSaved={(message) => { setDialog(null); setToast({ message, severity: 'success' }); load(); }} />
      <ConfirmDialog open={!!deleting} title="Delete admin"
        message={`Move "${deleting?.name}" to Trash? They won't be able to sign in until restored.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
