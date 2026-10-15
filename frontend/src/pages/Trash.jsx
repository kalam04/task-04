import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Paper, Snackbar, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/RestoreFromTrash';
import { api } from '../api/client';
import { errorMessage } from '../components/constants';

const TYPES = [
  { key: 'tasks', label: 'Tasks', title: (i) => i.title, detail: (i) => `Project: ${i.project_name}`, blocked: (i) => i.project_deleted },
  { key: 'projects', label: 'Projects', title: (i) => i.name, detail: (i) => `Includes ${i.client_count} client(s), ${i.task_count} task(s)` },
  { key: 'clients', label: 'Clients', title: (i) => i.name, detail: (i) => `Project: ${i.project_name}`, blocked: (i) => i.project_deleted },
  { key: 'developers', label: 'Developers', title: (i) => i.name, detail: (i) => `Username: ${i.username}` },
  { key: 'subtasks', label: 'Subtasks', title: (i) => i.title, detail: (i) => `Task: ${i.task_title}`, blocked: (i) => i.task_deleted, blockedText: 'Restore its task first' },
];

const formatDate = (iso) => new Date(iso).toLocaleString();

export default function Trash() {
  const [trash, setTrash] = useState(null);
  const [tab, setTab] = useState('tasks');
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api.get('/trash').then((r) => setTrash(r.data)), []);
  useEffect(() => { load(); }, [load]);

  const restore = async (type, item) => {
    try {
      const res = await api.post(`/trash/${type}/${item.id}/restore`);
      setToast({ message: res.data.message, severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
  };

  const type = TYPES.find((t) => t.key === tab);
  const items = [...(trash?.[tab] ?? [])].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));

  return (
    <Box>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 0.5 }}>Trash</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Deleted items stay here and can be restored at any time.
      </Typography>
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
          {TYPES.map((t) => (
            <Tab key={t.key} value={t.key} label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {t.label}
                {!!trash?.[t.key]?.length && <Chip size="small" label={trash[t.key].length} />}
              </Box>
            } />
          ))}
        </Tabs>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Name</TableCell><TableCell>Details</TableCell><TableCell>Deleted</TableCell><TableCell align="right" /></TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const blocked = type.blocked?.(item);
                return (
                  <TableRow key={item.id} hover>
                    <TableCell><Typography fontWeight={500}>{type.title(item)}</Typography></TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">{type.detail(item)}</Typography>
                      {blocked && <Typography variant="body2" color="warning.main">{type.blockedText || 'Restore its project first'}</Typography>}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(item.deleted_at)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" startIcon={<RestoreIcon />} disabled={!!blocked} onClick={() => restore(tab, item)}>Restore</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {trash && !items.length && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>No deleted {type.label.toLowerCase()}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
