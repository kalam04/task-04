import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Autocomplete, Box, Button, Chip, Link, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, List,
  ListItem, ListItemButton, ListItemText, Paper, Snackbar, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkOffIcon from '@mui/icons-material/LinkOff';
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

// Add an existing client company to the project, or create a new one
function AddClientDialog({ open, project, linkedIds, onClose, onDone }) {
  const [all, setAll] = useState([]);
  const [value, setValue] = useState(null); // an existing client, or a typed name
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setValue(null);
    setError('');
    api.get('/clients').then((r) => setAll(r.data));
  }, [open]);

  const options = all.filter((c) => !linkedIds.includes(c.id));
  const save = async () => {
    try {
      if (typeof value === 'string') {
        await api.post('/clients', { name: value, project_ids: [project.id] });
        onDone(`Client "${value.trim()}" created and added`);
      } else {
        await api.post(`/clients/${value.id}/projects/${project.id}`);
        onDone(`${value.name} added to ${project.name}`);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add client to {project?.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Autocomplete freeSolo autoFocus options={options} value={value}
          getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
          renderOption={(props, o) => (
            <li {...props} key={o.id}>
              <Box>
                {o.name}
                {!!o.projects?.length && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Also in: {o.projects.map((p) => p.name).join(', ')}</Typography>}
              </Box>
            </li>
          )}
          onChange={(e, v) => setValue(v)}
          onInputChange={(e, v, reason) => { if (reason === 'input') setValue(v || null); }}
          renderInput={(params) => (
            <TextField {...params} label="Client company" sx={{ mt: 1 }}
              helperText="Pick an existing client, or type a new name to create it" />
          )} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!value || (typeof value === 'string' && !value.trim())} onClick={save}>
          {typeof value === 'string' ? 'Create & add' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [clients, setClients] = useState([]);
  const [dialog, setDialog] = useState(null); // { kind: 'project'|'client', item }
  const [deleting, setDeleting] = useState(null); // { kind, item }
  const [adding, setAdding] = useState(false);
  const [unlinking, setUnlinking] = useState(null);
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
      // Editing a client's details here keeps its project links as they are
      await api.put(`/clients/${item.id}`, { name: form.name, email: form.email, phone: form.phone });
    }
    setDialog(null);
    notify(`${kind === 'project' ? 'Project' : 'Client'} saved`);
    loadProjects();
    loadClients();
  };

  const unlink = async () => {
    try {
      await api.delete(`/clients/${unlinking.id}/projects/${selectedId}`);
      notify(`${unlinking.name} removed from ${selected?.name}`);
      loadProjects();
      loadClients();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setUnlinking(null);
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
            <Button size="small" startIcon={<AddIcon />} disabled={!selected} onClick={() => setAdding(true)}>Add client</Button>
          </Stack>
          <Divider />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Phone</TableCell><TableCell>Also in</TableCell><TableCell align="right" /></TableRow>
              </TableHead>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>{c.email || '—'}</TableCell>
                    <TableCell>{c.phone || '—'}</TableCell>
                    <TableCell>
                      {c.projects?.filter((p) => p.id !== selectedId).map((p) => <Chip key={p.id} size="small" label={p.name} sx={{ mr: 0.5, mb: 0.5 }} />)}
                      {!c.projects?.some((p) => p.id !== selectedId) && '—'}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit details"><IconButton size="small" onClick={() => setDialog({ kind: 'client', item: c })}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Remove from this project (the client stays)"><IconButton size="small" color="error" onClick={() => setUnlinking(c)}><LinkOffIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {!clients.length && (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {selected ? 'No clients in this project' : 'Select or create a project'}
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 2, pt: 1 }}>
            Clients are shared companies — one client can be in several projects. Manage all clients and their portal logins on the{' '}
            <Link component={RouterLink} to="/clients">Clients</Link> page.
          </Typography>
        </Paper>
      </Stack>
      <AddClientDialog open={adding} project={selected} linkedIds={clients.map((c) => c.id)} onClose={() => setAdding(false)}
        onDone={(msg) => { setAdding(false); notify(msg); loadProjects(); loadClients(); }} />
      <ConfirmDialog open={!!unlinking} title="Remove client from project" confirmLabel="Remove"
        message={`Remove ${unlinking?.name} from ${selected?.name}? The client company stays (with its other projects), and existing tasks keep their client.`}
        onCancel={() => setUnlinking(null)} onConfirm={unlink} />

      <FormDialog open={!!dialog} onClose={() => setDialog(null)} onSubmit={save}
        title={`${dialog?.item ? 'Edit' : 'New'} ${dialog?.kind === 'project' ? 'Project' : 'Client'}`}
        fields={dialog?.kind === 'project' ? PROJECT_FIELDS : CLIENT_FIELDS} initial={dialog?.item} />
      <ConfirmDialog open={!!deleting} title={`Delete ${deleting?.kind}`}
        message={deleting?.kind === 'project'
          ? `Move "${deleting?.item.name}" and its tasks to Trash? Restoring the project brings them back. Its clients stay (they're shared).`
          : `Move client "${deleting?.item.name}" to Trash? Tasks linked to this client keep it. You can restore it later.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
