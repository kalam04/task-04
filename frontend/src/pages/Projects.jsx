import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, List,
  ListItem, ListItemButton, ListItemText, Paper, Snackbar, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../api/client';
import { errorMessage } from '../components/constants';
import ConfirmDialog from '../components/ConfirmDialog';

function FormDialog({ open, title, fields, initial, onClose, onSubmit }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setForm(Object.fromEntries(fields.map((f) => [f.name, initial?.[f.name] ?? ''])));
      setError('');
    }
  }, [open, initial, fields]);

  const submit = async () => {
    try {
      await onSubmit(form);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Stack spacing={2} sx={{ mt: 1 }}>
          {fields.map((f, i) => (
            <TextField key={f.name} label={f.label} required={f.required} multiline={f.multiline}
              minRows={f.multiline ? 3 : undefined} autoFocus={i === 0}
              value={form[f.name] ?? ''} onChange={(e) => setForm((s) => ({ ...s, [f.name]: e.target.value }))} />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

const PROJECT_FIELDS = [
  { name: 'name', label: 'Project name', required: true },
  { name: 'description', label: 'Description', multiline: true },
];
const CLIENT_FIELDS = [
  { name: 'name', label: 'Client name', required: true },
  { name: 'email', label: 'Email' },
  { name: 'phone', label: 'Phone' },
];

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [clients, setClients] = useState([]);
  const [dialog, setDialog] = useState(null); // { kind: 'project'|'client', item }
  const [deleting, setDeleting] = useState(null); // { kind, item }
  const [toast, setToast] = useState(null);

  const selected = projects.find((p) => p.id === selectedId);
  const notify = (message, severity = 'success') => setToast({ message, severity });

  const loadProjects = useCallback(() => api.get('/projects').then((r) => {
    setProjects(r.data);
    setSelectedId((id) => (r.data.some((p) => p.id === id) ? id : r.data[0]?.id ?? null));
  }), []);
  const loadClients = useCallback(() => {
    if (!selectedId) return setClients([]);
    api.get('/clients', { params: { project_id: selectedId } }).then((r) => setClients(r.data));
  }, [selectedId]);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadClients(); }, [loadClients]);

  const save = async (form) => {
    const { kind, item } = dialog;
    if (kind === 'project') {
      const res = item ? await api.put(`/projects/${item.id}`, form) : await api.post('/projects', form);
      if (!item) setSelectedId(res.data.id);
    } else {
      const payload = { ...form, project_id: selectedId };
      if (item) await api.put(`/clients/${item.id}`, payload);
      else await api.post('/clients', payload);
    }
    setDialog(null);
    notify(`${kind === 'project' ? 'Project' : 'Client'} saved`);
    loadProjects();
    loadClients();
  };

  const remove = async () => {
    const { kind, item } = deleting;
    try {
      await api.delete(`/${kind === 'project' ? 'projects' : 'clients'}/${item.id}`);
      notify(`${kind === 'project' ? 'Project' : 'Client'} moved to Trash`);
      loadProjects();
      loadClients();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setDeleting(null);
  };

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>Projects &amp; Clients</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Paper variant="outlined" sx={{ width: { xs: '100%', md: 300 }, flexShrink: 0 }}>
          <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography fontWeight={600}>Projects</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setDialog({ kind: 'project' })}>Add</Button>
          </Stack>
          <Divider />
          <List dense disablePadding>
            {projects.map((p) => (
              <ListItem key={p.id} disablePadding secondaryAction={
                <Stack direction="row">
                  <IconButton size="small" onClick={() => setDialog({ kind: 'project', item: p })}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => setDeleting({ kind: 'project', item: p })}><DeleteIcon fontSize="small" /></IconButton>
                </Stack>
              }>
                <ListItemButton selected={p.id === selectedId} onClick={() => setSelectedId(p.id)} sx={{ pr: 10 }}>
                  <ListItemText primary={p.name} secondary={`${p.client_count} clients · ${p.task_count} tasks`} />
                </ListItemButton>
              </ListItem>
            ))}
            {!projects.length && <ListItem><ListItemText secondary="No projects yet" /></ListItem>}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ flexGrow: 1, width: '100%', minWidth: 0 }}>
          <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography fontWeight={600}>{selected ? `Clients of ${selected.name}` : 'Clients'}</Typography>
              {selected?.description && <Typography variant="body2" color="text.secondary">{selected.description}</Typography>}
            </Box>
            <Button size="small" startIcon={<AddIcon />} disabled={!selected} onClick={() => setDialog({ kind: 'client' })}>Add client</Button>
          </Stack>
          <Divider />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Phone</TableCell><TableCell align="right" /></TableRow>
              </TableHead>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.email || '—'}</TableCell>
                    <TableCell>{c.phone || '—'}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog({ kind: 'client', item: c })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting({ kind: 'client', item: c })}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!clients.length && (
                  <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {selected ? 'No clients in this project' : 'Select or create a project'}
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Stack>

      <FormDialog open={!!dialog} onClose={() => setDialog(null)} onSubmit={save}
        title={`${dialog?.item ? 'Edit' : 'New'} ${dialog?.kind === 'project' ? 'Project' : 'Client'}`}
        fields={dialog?.kind === 'project' ? PROJECT_FIELDS : CLIENT_FIELDS} initial={dialog?.item} />
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.kind}`}
        message={deleting?.kind === 'project'
          ? `Move "${deleting?.item.name}" with all its clients and tasks to Trash? Restoring the project brings them back.`
          : `Move client "${deleting?.item.name}" to Trash? Tasks linked to this client keep it. You can restore it later.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
