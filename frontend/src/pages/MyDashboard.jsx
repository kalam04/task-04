import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Grid, IconButton, Link, List, ListItem,
  ListItemButton, ListItemText, Paper, Snackbar, Stack, Tooltip, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../api/client';
import { DeclineRequestDialog, respondToRequest } from '../components/Requests';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { useAuth } from '../context/AuthContext';
import {
  PRIORITIES, STATUSES, byValue, dueState, errorMessage, estimateSeconds, formatDuration, projectColorFn, timeAgo,
} from '../components/constants';
import useNow, { totalMs } from '../components/useNow';

const DAY_MS = 86400000;
const startOfToday = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const startOfWeek = (today) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
const hoursLabel = (seconds) => `${(seconds / 3600).toFixed(1)} h`;
// Running timer as a ticking clock, e.g. 1:05:09
const clock = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

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

// Logged time vs estimate for one task: a thin bar, red with "over" once past the estimate
function EstimateProgress({ task, now }) {
  const est = estimateSeconds(task);
  const logged = totalMs(task, now) / 1000;
  if (!est) {
    return <Typography variant="caption" color="text.secondary">{logged ? `${formatDuration(logged * 1000)} logged · no estimate` : 'No estimate'}</Typography>;
  }
  const ratio = logged / est;
  const over = ratio > 1;
  return (
    <Tooltip title={`${hoursLabel(logged)} logged of ${hoursLabel(est)} estimated`}>
      <Box sx={{ minWidth: 140 }}>
        <Box sx={{ height: 6, bgcolor: 'action.hover', borderRadius: '0 4px 4px 0', mb: 0.25 }}>
          <Box sx={{ width: `${Math.min(100, Math.max(2, ratio * 100))}%`, height: '100%', borderRadius: '0 4px 4px 0',
            bgcolor: over ? 'error.main' : 'primary.main' }} />
        </Box>
        <Typography variant="caption" color={over ? 'error' : 'text.secondary'}>
          {formatDuration(logged * 1000)} of {formatDuration(est * 1000)}{over ? ' · over estimate' : ''}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// Hours per day this week: one hue, value in the tooltip, labels only on today and the busiest day
function WeekChart({ days, todayIndex }) {
  const max = Math.max(...days.map((d) => d.seconds), 0);
  const busiest = max ? days.findIndex((d) => d.seconds === max) : -1;
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <Box role="img" aria-label={days.map((d, i) => `${names[i]} ${hoursLabel(d.seconds)}`).join(', ')}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end', height: 140, borderBottom: 1, borderColor: 'divider', px: 0.5 }}>
        {days.map((d, i) => {
          const pct = max ? (d.seconds / max) * 100 : 0;
          const showLabel = d.seconds > 0 && (i === todayIndex || i === busiest);
          return (
            <Tooltip key={d.start} title={`${new Date(d.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}: ${hoursLabel(d.seconds)}`}>
              <Box sx={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', cursor: 'default' }}>
                {showLabel && <Typography variant="caption" sx={{ mb: 0.25, fontWeight: 600 }}>{(d.seconds / 3600).toFixed(1)}</Typography>}
                <Box sx={{ width: '100%', maxWidth: 28, height: `${pct}%`, minHeight: d.seconds ? 3 : 0,
                  bgcolor: 'primary.main', borderRadius: '4px 4px 0 0', '&:hover': { filter: 'brightness(0.9)' } }} />
              </Box>
            </Tooltip>
          );
        })}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ px: 0.5, mt: 0.5 }}>
        {names.map((n, i) => (
          <Typography key={n} variant="caption" sx={{ flex: 1, textAlign: 'center', fontWeight: i === todayIndex ? 700 : 400 }}
            color={i === todayIndex ? 'text.primary' : 'text.secondary'}>{i === todayIndex ? 'Today' : n}</Typography>
        ))}
      </Stack>
    </Box>
  );
}

export default function MyDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [projects, setProjects] = useState([]);
  const [toast, setToast] = useState(null);
  const [requests, setRequests] = useState([]);
  const [declining, setDeclining] = useState(null);

  const running = tasks?.find((t) => t.running_since);
  const now = useNow(!!running, 1000);
  const today = startOfToday();
  const week = startOfWeek(today);
  const todayIndex = Math.round((today - week) / DAY_MS);

  const load = useCallback(() => {
    const t = startOfToday();
    api.get('/dashboard/me', { params: { today: t.toISOString(), week: startOfWeek(t).toISOString() } })
      .then((r) => setSummary({ ...r.data, fetchedAt: Date.now() }));
    api.get('/tasks', { params: { developer_id: user.id, status: 'open' } }).then((r) => setTasks(r.data));
    api.get('/assignment-requests').then((r) => setRequests(r.data));
  }, [user.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/projects').then((r) => setProjects(r.data)); }, []);

  const colorOf = useMemo(() => projectColorFn(projects), [projects]);

  const timer = async (task, action) => {
    try {
      await api.post(`/tasks/${task.id}/timer/${action}`);
      setToast({ message: action === 'start' ? `Timer started: ${task.title}` : 'Timer stopped', severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
  };

  const answer = async (r, action, reason) => {
    try {
      setToast({ message: await respondToRequest(r.id, action, reason), severity: 'success' });
      load();
    } catch (err) {
      setToast({ message: errorMessage(err), severity: 'error' });
    }
  };

  if (!summary || !tasks) return null;

  const dueToday = tasks.filter((t) => dueState(t)?.kind === 'today');
  const overdue = tasks.filter((t) => dueState(t)?.kind === 'overdue');
  // While a timer runs, the totals keep counting up from when they were loaded
  const liveExtra = running ? Math.max(0, now - summary.fetchedAt) / 1000 : 0;
  const days = summary.days.map((d, i) => (i === todayIndex ? { ...d, seconds: d.seconds + liveExtra } : d));
  const todayTotal = summary.todaySeconds + liveExtra;
  const weekTotal = summary.weekSeconds + liveExtra;
  const projectTotal = summary.byProject.reduce((s, p) => s + p.seconds, 0);
  const nextUp = tasks.find((t) => !t.running_since);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-end' }, mb: 2, gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>{greeting()}, {user.name.split(' ')[0]}</Typography>
          <Typography variant="body2" color="text.secondary">
            {today.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} to={`/tasks?developer_id=${user.id}`} endIcon={<ArrowForwardIcon />}>All my tasks</Button>
          <Button component={RouterLink} to="/tasks?new=1" variant="outlined" startIcon={<AddIcon />}>New task</Button>
        </Stack>
      </Stack>

      {requests.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 2, borderColor: 'warning.main', borderWidth: 2 }}>
          <Stack direction="row" spacing={1} sx={{ p: 2, pb: 1, alignItems: 'center' }}>
            <HowToRegIcon color="warning" />
            <Typography fontWeight={600}>{requests.length} request{requests.length === 1 ? '' : 's'} waiting for you</Typography>
          </Stack>
          <List disablePadding>
            {requests.map((r) => (
              <ListItem key={r.id} divider sx={{ flexWrap: 'wrap', gap: 1 }}>
                <ListItemText sx={{ minWidth: 240 }}
                  primary={<Link component={RouterLink} to={`/tasks?task=${r.task_id}&tab=comments`} underline="hover" color="inherit" fontWeight={500}>{r.task_title}</Link>}
                  secondary={<>
                    {r.requested_by_name} asked you · {r.project_name} · {byValue(PRIORITIES, r.priority).label} priority{r.due_date ? ` · due ${r.due_date}` : ''} · {timeAgo(r.created_at)}
                    {r.message && <span style={{ display: 'block', fontStyle: 'italic' }}>“{r.message}”</span>}
                  </>} />
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="contained" color="success" onClick={() => answer(r, 'accept')}>Accept</Button>
                  <Button size="small" color="error" onClick={() => setDeclining({ ...r, title: r.task_title })}>Decline</Button>
                </Stack>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      {/* What I'm working on right now */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderColor: running ? 'primary.main' : undefined, borderWidth: running ? 2 : 1 }}>
        {running ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' }} />
                <Typography variant="body2" color="text.secondary">Working on now</Typography>
              </Stack>
              <Link component={RouterLink} to={`/tasks?task=${running.id}&tab=time`} variant="h6" underline="hover" color="inherit">{running.title}</Link>
              <Typography variant="body2" color="text.secondary">{running.project_name}{running.client_name ? ` · ${running.client_name}` : ''}</Typography>
            </Box>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexShrink: 0 }}>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="h4" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {clock(now - new Date(running.running_since).getTime())}
                </Typography>
                <Typography variant="caption" color="text.secondary">this session</Typography>
              </Box>
              <Button variant="contained" color="error" size="large" startIcon={<StopIcon />} onClick={() => timer(running, 'stop')}>Stop</Button>
            </Stack>
          </Stack>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="body2" color="text.secondary">No timer running</Typography>
              {nextUp ? (
                <Typography>Next up: <b>{nextUp.title}</b> <Chip size="small" sx={{ ml: 0.5 }} label={byValue(PRIORITIES, nextUp.priority).label} color={byValue(PRIORITIES, nextUp.priority).color} /></Typography>
              ) : <Typography>You have no open tasks. 🎉</Typography>}
            </Box>
            {nextUp && <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => timer(nextUp, 'start')}>Start working</Button>}
          </Stack>
        )}
      </Paper>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatTile label="Open tasks" value={tasks.length} hint="pending + in progress" to={`/tasks?developer_id=${user.id}&status=open`} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatTile label="Due today" value={dueToday.length} color={dueToday.length ? 'warning.main' : undefined} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatTile label="Overdue" value={overdue.length} color={overdue.length ? 'error' : undefined} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatTile label="Today" value={hoursLabel(todayTotal)} hint="hours logged" />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatTile label="This week" value={hoursLabel(weekTotal)} hint="hours logged" />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatTile label="Completed" value={summary.completedThisWeek} hint="this week" />
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined" sx={{ height: '100%' }}>
            <Stack direction="row" sx={{ p: 2, pb: 1, justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Typography fontWeight={600}>My focus list</Typography>
              <Typography variant="caption" color="text.secondary">by priority, then due date</Typography>
            </Stack>
            <List disablePadding>
              {tasks.slice(0, 8).map((t) => {
                const priority = byValue(PRIORITIES, t.priority);
                const status = byValue(STATUSES, t.status);
                const due = dueState(t);
                return (
                  <ListItem key={t.id} divider disablePadding secondaryAction={t.running_since ? (
                    <Tooltip title="Stop timer"><IconButton color="error" onClick={() => timer(t, 'stop')}><StopIcon /></IconButton></Tooltip>
                  ) : (
                    <Tooltip title={running ? 'Stop the running timer first' : t.status === 'pending' ? 'Start working' : 'Start timer'}>
                      <span><IconButton color="primary" disabled={!!running} onClick={() => timer(t, 'start')}><PlayArrowIcon /></IconButton></span>
                    </Tooltip>
                  )}>
                    <ListItemButton onClick={() => navigate(`/tasks?task=${t.id}&tab=comments`)} sx={{ pr: 7, alignItems: 'flex-start' }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} sx={{ width: '100%', alignItems: { sm: 'center' } }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.25, flexWrap: 'wrap', rowGap: 0.5 }}>
                            <Chip size="small" label={priority.label} color={priority.color} sx={{ height: 20 }} />
                            <Chip size="small" variant="outlined" label={status.label} color={status.color} sx={{ height: 20 }} />
                            {due?.kind === 'overdue' && <Chip size="small" color="error" label={`${due.days}d overdue`} sx={{ height: 20 }} />}
                            {due?.kind === 'today' && <Chip size="small" color="warning" label="Due today" sx={{ height: 20 }} />}
                          </Stack>
                          <Typography fontWeight={500} noWrap>{t.title}</Typography>
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {t.project_name}{t.due_date && !due ? ` · due ${t.due_date}` : ''}
                            {t.subtask_total ? ` · ${t.subtask_done}/${t.subtask_total} subtasks` : ''}
                          </Typography>
                        </Box>
                        <EstimateProgress task={t} now={now} />
                      </Stack>
                    </ListItemButton>
                  </ListItem>
                );
              })}
              {!tasks.length && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>Nothing open. Pick up an unassigned task →</Typography>
              )}
            </List>
            {tasks.length > 8 && (
              <Box sx={{ p: 1, textAlign: 'center' }}>
                <Button component={RouterLink} to={`/tasks?developer_id=${user.id}&status=open`}>View all {tasks.length} open tasks</Button>
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Stack spacing={2} sx={{ height: '100%' }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1.5 }}>
                <Typography fontWeight={600}>Hours this week</Typography>
                <Typography variant="body2" color="text.secondary">{hoursLabel(weekTotal)} total</Typography>
              </Stack>
              <WeekChart days={days} todayIndex={todayIndex} />
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography fontWeight={600} sx={{ mb: 1.5 }}>This week by project</Typography>
              {summary.byProject.length ? (
                <Stack spacing={1}>
                  {summary.byProject.map((p) => (
                    <Box key={p.id}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.25 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: colorOf(p.id), flexShrink: 0 }} />
                          <Typography variant="body2" noWrap>{p.name}</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ flexShrink: 0, ml: 1 }}>
                          <b>{Math.round((p.seconds / projectTotal) * 100)}%</b> · {hoursLabel(p.seconds)}
                        </Typography>
                      </Stack>
                      <Box sx={{ height: 6, bgcolor: 'action.hover', borderRadius: '0 4px 4px 0' }}>
                        <Box sx={{ width: `${Math.max(2, (p.seconds / projectTotal) * 100)}%`, height: '100%', bgcolor: colorOf(p.id), borderRadius: '0 4px 4px 0' }} />
                      </Box>
                    </Box>
                  ))}
                </Stack>
              ) : <Typography variant="body2" color="text.secondary">No time logged this week yet.</Typography>}
            </Paper>
          </Stack>
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper variant="outlined">
            <Typography fontWeight={600} sx={{ p: 2, pb: 1 }}>Recent comments on my tasks</Typography>
            <List dense disablePadding>
              {summary.recentComments.map((c) => (
                <ListItemButton key={c.id} divider onClick={() => navigate(`/tasks?task=${c.task_id}&tab=comments`)}>
                  <ListItemText
                    primary={<><b>{c.user_name ?? 'Someone'}</b> on <i>{c.task_title}</i></>}
                    secondary={<><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.body}</span>{timeAgo(c.created_at)}</>}
                  />
                </ListItemButton>
              ))}
              {!summary.recentComments.length && (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No comments from others yet.</Typography>
              )}
            </List>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <StatTile label="Unassigned tasks you could pick up" value={summary.unassigned}
            hint={summary.unassigned ? 'Open the list and assign one to yourself →' : 'Nothing waiting right now'}
            to="/tasks?developer_id=none" color={summary.unassigned ? 'warning.main' : undefined} />
        </Grid>
      </Grid>

      {(overdue.length > 0) && (
        <Alert severity="error" sx={{ mt: 2 }}>
          You have {overdue.length} overdue task{overdue.length === 1 ? '' : 's'}: {overdue.map((t) => t.title).join(', ')}.
        </Alert>
      )}

      <DeclineRequestDialog request={declining} onClose={() => setDeclining(null)}
        onConfirm={(reason) => { answer(declining, 'decline', reason); setDeclining(null); }} />
      <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast && <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>{toast.message}</Alert>}
      </Snackbar>
    </Box>
  );
}
