import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Grid, Link, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { api } from '../api/client';
import { STATUSES, byValue, errorMessage, formatDuration } from '../components/constants';

const H = 3600;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Each preset returns [from, to) as local dates
const PRESETS = {
  today: { label: 'Today', range: (t) => [t, addDays(t, 1)] },
  week: { label: 'This week', range: (t) => { const s = addDays(t, -((t.getDay() + 6) % 7)); return [s, addDays(s, 7)]; } },
  last7: { label: 'Last 7 days', range: (t) => [addDays(t, -6), addDays(t, 1)] },
  month: { label: 'This month', range: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 1)] },
  lastMonth: { label: 'Last month', range: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 1)] },
  last30: { label: 'Last 30 days', range: (t) => [addDays(t, -29), addDays(t, 1)] },
  custom: { label: 'Custom range' },
};

const hours = (seconds) => (seconds / H).toFixed(1);

function StatTile({ label, value, hint, to, color }) {
  const content = (
    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h4" fontWeight={600} color={color}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </CardContent>
  );
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {to ? <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>{content}</CardActionArea> : content}
    </Card>
  );
}

// A thin single-hue bar for magnitude, with the exact value beside it
function HoursBar({ seconds, max }) {
  const pct = max ? Math.max(2, (seconds / max) * 100) : 0;
  return (
    <Tooltip title={`${hours(seconds)} hours (${formatDuration(seconds * 1000)})`} placement="top">
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 180 }}>
        <Box sx={{ flex: 1, height: 10, bgcolor: 'action.hover', borderRadius: '0 4px 4px 0' }}>
          <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: 'primary.main', borderRadius: '0 4px 4px 0' }} />
        </Box>
        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 56, textAlign: 'right' }}>{hours(seconds)} h</Typography>
      </Stack>
    </Tooltip>
  );
}

function HoursTable({ title, rows, nameLabel, renderName }) {
  const max = Math.max(0, ...rows.map((r) => r.seconds));
  return (
    <Paper variant="outlined" sx={{ height: '100%' }}>
      <Typography fontWeight={600} sx={{ p: 2, pb: 1 }}>{title}</Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>{nameLabel}</TableCell><TableCell>Hours</TableCell><TableCell align="right">Tasks</TableCell></TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} hover>
                <TableCell sx={{ maxWidth: 220 }}>{renderName ? renderName(r) : r.name ?? '—'}</TableCell>
                <TableCell sx={{ width: '55%' }}><HoursBar seconds={r.seconds} max={max} /></TableCell>
                <TableCell align="right">{r.tasks_worked}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>No time logged in this period</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

// Excel opens UTF-8 CSV correctly (including Bangla) when it starts with a BOM
function downloadCsv(filename, header, rows) {
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const fmtLocal = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function Reports() {
  const [preset, setPreset] = useState('month');
  const [custom, setCustom] = useState(() => {
    const t = startOfDay(new Date());
    return { from: toInput(addDays(t, -6)), to: toInput(t) };
  });
  const [projectId, setProjectId] = useState('');
  const [developerId, setDeveloperId] = useState('');
  const [projects, setProjects] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/projects').then((r) => setProjects(r.data));
    api.get('/developers').then((r) => setDevelopers(r.data));
  }, []);

  const range = useMemo(() => {
    if (preset === 'custom') {
      const from = new Date(`${custom.from}T00:00`);
      const to = addDays(new Date(`${custom.to}T00:00`), 1); // include the whole "to" day
      return [from, to];
    }
    return PRESETS[preset].range(startOfDay(new Date()));
  }, [preset, custom]);

  const query = useMemo(() => ({
    from: range[0].toISOString(),
    to: range[1].toISOString(),
    ...(projectId && { project_id: projectId }),
    ...(developerId && { developer_id: developerId }),
  }), [range, projectId, developerId]);

  const load = useCallback(() => {
    setError('');
    api.get('/reports/summary', { params: query }).then((r) => setData(r.data)).catch((err) => setError(errorMessage(err)));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const periodLabel = `${range[0].toLocaleDateString([], { dateStyle: 'medium' })} – ${addDays(range[1], -1).toLocaleDateString([], { dateStyle: 'medium' })}`;
  const fileSuffix = `${toInput(range[0])}_to_${toInput(addDays(range[1], -1))}`;

  const exportTimesheet = async () => {
    try {
      const { data: rows } = await api.get('/reports/timesheet', { params: query });
      downloadCsv(`timesheet_${fileSuffix}.csv`,
        ['Start', 'End', 'Hours (in period)', 'Developer', 'Project', 'Client', 'Task', 'Task status', 'Note'],
        rows.map((r) => [fmtLocal(r.started_at), r.ended_at ? fmtLocal(r.ended_at) : 'Running', hours(r.seconds_in_range),
          r.developer_name, r.project_name, r.client_name, r.task_title, byValue(STATUSES, r.status).label, r.note]));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const exportSummary = () => {
    const rows = [
      ...data.byDeveloper.map((r) => ['Developer', r.name ?? '—', '', hours(r.seconds), r.tasks_worked]),
      ...data.byProject.map((r) => ['Project', r.name, '', hours(r.seconds), r.tasks_worked]),
      ...data.byClient.map((r) => ['Client', r.name, r.project_name, hours(r.seconds), r.tasks_worked]),
    ];
    downloadCsv(`hours_summary_${fileSuffix}.csv`, ['Group', 'Name', 'Project', 'Hours', 'Tasks worked on'], rows);
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, mb: 2, gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>Dashboard &amp; Reports</Typography>
          <Typography variant="body2" color="text.secondary">{periodLabel}</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<FileDownloadIcon />} disabled={!data} onClick={exportSummary}>Hours summary</Button>
          <Button variant="contained" startIcon={<FileDownloadIcon />} onClick={exportTimesheet}>Timesheet (Excel)</Button>
        </Stack>
      </Stack>

      {/* Filters: one row above everything they affect */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField size="small" select label="Period" value={preset} onChange={(e) => setPreset(e.target.value)} sx={{ minWidth: 170 }}>
            {Object.entries(PRESETS).map(([k, p]) => <MenuItem key={k} value={k}>{p.label}</MenuItem>)}
          </TextField>
          {preset === 'custom' && (
            <>
              <TextField size="small" type="date" label="From" value={custom.from} slotProps={{ inputLabel: { shrink: true } }}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <TextField size="small" type="date" label="To" value={custom.to} slotProps={{ inputLabel: { shrink: true } }}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          )}
          <TextField size="small" select label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="">All projects</MenuItem>
            {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <TextField size="small" select label="Developer" value={developerId} onChange={(e) => setDeveloperId(e.target.value)} sx={{ minWidth: 180 }}>
            <MenuItem value="">All developers</MenuItem>
            {developers.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {data && (
        <>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <StatTile label="Hours logged" value={hours(data.totals.seconds)} hint="in this period" />
            </Grid>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <StatTile label="Tasks completed" value={data.totals.completed} hint="in this period" />
            </Grid>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <StatTile label="Open tasks" value={data.totals.open} hint="right now"
                to={`/tasks?status=open${projectId ? `&project_id=${projectId}` : ''}${developerId ? `&developer_id=${developerId}` : ''}`} />
            </Grid>
            <Grid size={{ xs: 6, md: 2.4 }}>
              <StatTile label="Overdue" value={data.totals.overdue} hint="open & past due date" color={data.totals.overdue ? 'error' : undefined} />
            </Grid>
            <Grid size={{ xs: 12, md: 2.4 }}>
              <StatTile label="Unassigned" value={data.totals.unassigned} hint="open, no developer" to="/tasks?developer_id=none"
                color={data.totals.unassigned ? 'warning.main' : undefined} />
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ mb: 2 }}>
            <Typography fontWeight={600} sx={{ p: 2, pb: 1 }}>Current workload</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Developer</TableCell><TableCell align="right">In progress</TableCell>
                    <TableCell align="right">Pending</TableCell><TableCell align="right">Overdue</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.workload.map((w) => (
                    <TableRow key={w.id} hover>
                      <TableCell>
                        <Link component={RouterLink} to={`/tasks?developer_id=${w.id}&status=open`}>{w.name}</Link>
                      </TableCell>
                      <TableCell align="right">{w.in_progress}</TableCell>
                      <TableCell align="right">{w.pending}</TableCell>
                      <TableCell align="right">
                        {w.overdue ? <Chip size="small" color="error" label={`${w.overdue} overdue`} /> : <Typography variant="body2" color="text.secondary">0</Typography>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, lg: 6 }}>
              <HoursTable title="Hours by developer" nameLabel="Developer" rows={data.byDeveloper} />
            </Grid>
            <Grid size={{ xs: 12, lg: 6 }}>
              <HoursTable title="Hours by project" nameLabel="Project" rows={data.byProject} />
            </Grid>
            <Grid size={12}>
              <HoursTable title="Hours by client" nameLabel="Client" rows={data.byClient} renderName={(r) => (
                <>
                  <Typography variant="body2">{r.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.project_name}</Typography>
                </>
              )} />
            </Grid>
          </Grid>

          <Paper variant="outlined">
            <Box sx={{ p: 2, pb: 1 }}>
              <Typography fontWeight={600}>Estimate vs actual</Typography>
              <Typography variant="caption" color="text.secondary">
                Tasks with an estimate that were worked on or completed in this period. Actual = all time logged on the task. 1 day = {data.hoursPerDay} hours.
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small" sx={{ '& th, & td': { whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Task</TableCell><TableCell>Developer</TableCell><TableCell>Status</TableCell>
                    <TableCell align="right">Estimate</TableCell><TableCell align="right">Actual</TableCell><TableCell align="right">Difference</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.estimates.map((t) => {
                    const diff = t.actual_seconds - t.estimate_seconds;
                    const over = diff > 0;
                    const onTarget = Math.abs(diff) < 0.05 * H;
                    const status = byValue(STATUSES, t.status);
                    return (
                      <TableRow key={t.id} hover>
                        <TableCell sx={{ whiteSpace: 'normal !important', minWidth: 200 }}>
                          <Link component={RouterLink} to={`/tasks?task=${t.id}&tab=time`}>{t.title}</Link>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t.project_name}</Typography>
                        </TableCell>
                        <TableCell>{t.developer_name ?? '—'}</TableCell>
                        <TableCell><Chip size="small" variant="outlined" label={status.label} color={status.color} /></TableCell>
                        <TableCell align="right">{hours(t.estimate_seconds)} h</TableCell>
                        <TableCell align="right">{hours(t.actual_seconds)} h</TableCell>
                        <TableCell align="right">
                          {onTarget ? <Chip size="small" variant="outlined" label="= on estimate" /> : (
                            <Chip size="small" variant="outlined" color={over ? 'error' : 'success'}
                              label={`${over ? '▲' : '▼'} ${hours(Math.abs(diff))} h ${over ? 'over' : 'under'}`} />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!data.estimates.length && (
                    <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>No estimated tasks were worked on in this period</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}
    </Box>
  );
}
