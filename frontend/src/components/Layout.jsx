import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Alert, AppBar, Box, Button, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Menu, MenuItem, Snackbar, Toolbar, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import InsightsIcon from '@mui/icons-material/Insights';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CampaignIcon from '@mui/icons-material/Campaign';
import { ROLE_LABELS } from './constants';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import KeyIcon from '@mui/icons-material/Key';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import NotificationsBell from './NotificationsBell';
import ChangePasswordDialog from './ChangePasswordDialog';
import MenuIcon from '@mui/icons-material/Menu';
import AssignmentIcon from '@mui/icons-material/Assignment';
import FolderIcon from '@mui/icons-material/Folder';
import GroupIcon from '@mui/icons-material/Group';
import LogoutIcon from '@mui/icons-material/Logout';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { useAuth } from '../context/AuthContext';

const DRAWER_WIDTH = 220;

export default function Layout() {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  const isAdmin = user.role === 'admin';
  const [userMenu, setUserMenu] = useState(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [toast, setToast] = useState('');

  const links = [
    ...(user.role === 'developer' ? [{ to: '/dashboard', label: 'My Dashboard', icon: <DashboardIcon /> }] : []),
    { to: '/tasks', label: 'Tasks', icon: <AssignmentIcon /> },
    ...(isAdmin ? [
      { to: '/reports', label: 'Dashboard & Reports', icon: <InsightsIcon /> },
      { to: '/projects', label: 'Projects & Clients', icon: <FolderIcon /> },
      { to: '/developers', label: 'Developers', icon: <GroupIcon /> },
      { to: '/staff', label: 'Marketing & Support', icon: <CampaignIcon /> },
      { to: '/admins', label: 'Admins', icon: <AdminPanelSettingsIcon /> },
      { to: '/trash', label: 'Trash', icon: <DeleteOutlineIcon /> },
    ] : []),
  ];

  const drawer = (
    <Box>
      <Toolbar />
      <List>
        {links.map((l) => (
          <ListItemButton key={l.to} component={NavLink} to={l.to} onClick={() => setOpen(false)}
            sx={{ '&.active': { bgcolor: 'action.selected' } }}>
            <ListItemIcon>{l.icon}</ListItemIcon>
            <ListItemText primary={l.label} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          {!isDesktop && (
            <IconButton color="inherit" edge="start" onClick={() => setOpen(true)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flexGrow: 1 }} noWrap>Task Management</Typography>
          <NotificationsBell />
          <Button color="inherit" onClick={(e) => setUserMenu(e.currentTarget)} endIcon={<ArrowDropDownIcon />}
            sx={{ textTransform: 'none', ml: 1 }}>
            <Typography sx={{ display: { xs: 'none', sm: 'block' }, mr: 1 }}>{user.name || user.username}</Typography>
            <Chip size="small" label={ROLE_LABELS[user.role] ?? user.role} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'inherit', cursor: 'pointer' }} />
          </Button>
          <Menu anchorEl={userMenu} open={!!userMenu} onClose={() => setUserMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            <MenuItem disabled sx={{ opacity: '1 !important' }}>
              <ListItemText primary={user.name || user.username} secondary={`@${user.username}`} />
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setUserMenu(null); setPasswordOpen(true); }}>
              <ListItemIcon><KeyIcon fontSize="small" /></ListItemIcon>Change password
            </MenuItem>
            <MenuItem onClick={logout}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Drawer
        variant={isDesktop ? 'permanent' : 'temporary'}
        open={isDesktop || open}
        onClose={() => setOpen(false)}
        sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
      >
        {drawer}
      </Drawer>
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, bgcolor: 'grey.50', minHeight: '100vh' }}>
        <Toolbar />
        <Outlet />
        <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)}
          onChanged={() => { setPasswordOpen(false); setToast('Password changed'); }} />
        <Snackbar open={!!toast} autoHideDuration={3000} onClose={() => setToast('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity="success" variant="filled" onClose={() => setToast('')}>{toast}</Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
