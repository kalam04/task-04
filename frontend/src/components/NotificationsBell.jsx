import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge, Box, Button, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Popover, Tooltip, Typography,
} from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import { api } from '../api/client';
import { timeAgo } from './constants';

const ICONS = {
  assigned: <AssignmentIndIcon color="primary" />,
  comment: <ChatBubbleOutlineIcon color="action" />,
  completed: <CheckCircleOutlineIcon color="success" />,
  rejected: <HighlightOffIcon color="error" />,
  overdue: <EventBusyIcon color="warning" />,
  status: <SyncAltIcon color="action" />,
};

const POLL_MS = 30000;

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);
  const [data, setData] = useState({ unread: 0, items: [] });

  const load = useCallback(() => api.get('/notifications').then((r) => setData(r.data)).catch(() => {}), []);
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const open = (n) => {
    setAnchor(null);
    if (!n.is_read) api.post(`/notifications/${n.id}/read`).then(load);
    if (n.task_id && !n.task_deleted) navigate(`/tasks?task=${n.task_id}&tab=${n.type === 'comment' ? 'comments' : 'history'}`);
  };

  const readAll = () => api.post('/notifications/read-all').then(load);

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton color="inherit" onClick={(e) => { setAnchor(e.currentTarget); load(); }}>
          <Badge badgeContent={data.unread} color="error" max={99}><NotificationsIcon /></Badge>
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: 'calc(100vw - 32px)' } } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
          <Typography fontWeight={600}>Notifications</Typography>
          <Button size="small" disabled={!data.unread} onClick={readAll}>Mark all read</Button>
        </Box>
        <Divider />
        <List dense disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {data.items.map((n) => (
            <ListItemButton key={n.id} onClick={() => open(n)} alignItems="flex-start"
              sx={{ bgcolor: n.is_read ? undefined : 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
              <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>{ICONS[n.type] ?? <NotificationsIcon />}</ListItemIcon>
              <ListItemText primary={n.message} secondary={timeAgo(n.created_at)}
                slotProps={{ primary: { sx: { fontWeight: n.is_read ? 400 : 600, wordBreak: 'break-word' } } }} />
            </ListItemButton>
          ))}
          {!data.items.length && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>You're all caught up</Typography>
          )}
        </List>
      </Popover>
    </>
  );
}
