import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { api } from '../api/client';
import { errorMessage } from './constants';

export default function ChangePasswordDialog({ open, onClose, onChanged }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ current: '', next: '', confirm: '' });
      setError('');
    }
  }, [open]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mismatch = form.confirm && form.next !== form.confirm;

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.post('/auth/change-password', { current_password: form.current, new_password: form.next });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={save}>
        <DialogTitle>Change password</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Current password" type="password" autoComplete="current-password" required autoFocus
              value={form.current} onChange={set('current')} />
            <TextField label="New password" type="password" autoComplete="new-password" required
              value={form.next} onChange={set('next')} helperText="At least 8 characters" />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" required
              value={form.confirm} onChange={set('confirm')} error={!!mismatch} helperText={mismatch ? 'Passwords do not match' : ' '} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={saving || !form.current || form.next.length < 8 || form.next !== form.confirm}>
            Change password
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
