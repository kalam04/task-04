import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, List, ListItem,
  ListItemText, Paper, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyIcon from '@mui/icons-material/Key';
import { api } from '../api/client';
import { errorMessage } from '../components/constants';
import ConfirmDialog from '../components/ConfirmDialog';

function ClientDialog({ open, client, projects, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', projects: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setError('');
    setForm({
      name: client?.name ?? '', email: client?.email ?? '', phone: client?.phone ?? '',
      projects: projects.filter((p) => client?.projects?.some((cp) => cp.id === p.id)),
    });
  }, [open, client, projects]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const payload = { name: form.name, email: form.email, phone: form.phone, project_ids: form.projects.map((p) => p.id) };
    try {
      if (client) await api.put(`/clients/${client.id}`, payload);
      else await api.post('/clients', payload);
      onSaved(client ? 'Client updated' : 'Client added');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={save}>
        <DialogTitle>{client ? 'Edit client' : 'New client'}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Company name" required autoFocus value={form.name} onChange={set('name')} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Email" fullWidth value={form.email} onChange={set('email')} />
              <TextField label="Phone" fullWidth value={form.phone} onChange={set('phone')} />
            </Stack>
            <Autocomplete multiple options={projects} value={form.projects} getOptionLabel={(p) => p.name}
              isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(e, v) => setForm((f) => ({ ...f, projects: v }))}
              renderInput={(params) => <TextField {...params} label="Projects" helperText="A client can be in several projects" />} />
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

const emptyUser = { name: '', username: '', password: '' };

// Portal logins of one client company
function PortalUsersDialog({ client, onClose, onChanged }) {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null); // { id?, name, username, password }
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => client && api.get(`/clients/${client.id}/users`).then((r) => setUsers(r.data)), [client]);
  useEffect(() => { setForm(null); setError(''); load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (form.id) await api.put(`/clients/users/${form.id}`, form);
      else await api.post(`/clients/${client.id}/users`, form);
      setForm(null);
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/clients/users/${deleting.id}`);
      load();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
    setDeleting(null);
  };

  return (
    <Dialog open={!!client} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Portal logins · {client?.name}</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Portal users see only {client?.name}&apos;s tasks in its projects
          ({client?.projects?.map((p) => p.name).join(', ') || 'no projects yet'}). They can add tasks, comment and attach files.
        </Alert>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <List dense disablePadding>
          {users.map((u) => (
            <ListItem key={u.id} divider secondaryAction={
              <Stack direction="row">
                <Tooltip title="Edit / reset password"><IconButton size="small" onClick={() => setForm({ id: u.id, name: u.name, username: u.username, password: '' })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(u)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
              </Stack>
            }>
              <ListItemText primary={u.name} secondary={`Username: ${u.username}`} />
            </ListItem>
          ))}
          {!users.length && <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No portal logins yet.</Typography>}
        </List>
        {form ? (
          <Paper variant="outlined" component="form" onSubmit={save} sx={{ p: 2, mt: 2 }}>
            <Typography fontWeight={600} sx={{ mb: 1.5 }}>{form.id ? 'Edit login' : 'New login'}</Typography>
            <Stack spacing={2}>
              <TextField size="small" label="Person's name" required autoFocus value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <TextField size="small" label="Username" required autoComplete="off" value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
              <TextField size="small" type="password" label={form.id ? 'New password (leave blank to keep)' : 'Password'} required={!form.id}
                autoComplete="new-password" helperText="At least 8 characters. They can change it later from their name menu."
                value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button onClick={() => setForm(null)}>Cancel</Button>
                <Button type="submit" variant="contained">Save login</Button>
              </Stack>
            </Stack>
          </Paper>
        ) : (
          <Button startIcon={<AddIcon />} sx={{ mt: 2 }} onClick={() => setForm(emptyUser)}>Add portal login</Button>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
      <ConfirmDialog open={!!deleting} title="Delete portal login"
        message={`Move ${deleting?.name}'s login to Trash? They won't be able to sign in until restored.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
    </Dialog>
  );
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [dialog, setDialog] = useState(null); // { client? }
  const [portal, setPortal] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api.get('/clients').then((r) => {
    setClients(r.data);
    setPortal((p) => (p ? r.data.find((c) => c.id === p.id) ?? null : null));
  }), []);
  useEffect(() => {
    load();
    api.get('/projects').then((r) => setProjects(r.data));
  }, [load]);

  const remove = async () => {
    try {
      await api.delete(`/clients/${deleting.id}`);
      setToast({ message: 'Client moved to Trash', severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
    setDeleting(null);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>Clients</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({})}>New Client</Button>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Company</TableCell><TableCell>Contact</TableCell><TableCell>Projects</TableCell>
              <TableCell align="right">Portal logins</TableCell><TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id} hover>
                <TableCell><Typography fontWeight={500}>{c.name}</Typography></TableCell>
                <TableCell>
                  <Typography variant="body2">{c.email || '—'}</Typography>
                  {c.phone && <Typography variant="caption" color="text.secondary">{c.phone}</Typography>}
                </TableCell>
                <TableCell>
                  {c.projects.map((p) => <Chip key={p.id} size="small" label={p.name} sx={{ mr: 0.5, mb: 0.5 }} />)}
                  {!c.projects.length && <Typography variant="body2" color="text.secondary">No projects</Typography>}
                </TableCell>
                <TableCell align="right">
                  <Button size="small" startIcon={<KeyIcon />} onClick={() => setPortal(c)}>{c.portal_users || 'Add'}</Button>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog({ client: c })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {!clients.length && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>No clients yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        You can also add clients to a project from <Link component={RouterLink} to="/projects">Projects &amp; Clients</Link>.
      </Typography>

      <ClientDialog open={!!dialog} client={dialog?.client} projects={projects} onClose={() => setDialog(null)}
        onSaved={(message) => { setDialog(null); setToast({ message, severity: 'success' }); load(); }} />
      <PortalUsersDialog client={portal} onClose={() => setPortal(null)} onChanged={load} />
      <ConfirmDialog open={!!deleting} title="Delete client"
        message={`Move ${deleting?.name} to Trash? Its portal users can't sign in until it's restored. Tasks keep their client.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
