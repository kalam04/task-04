import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Tasks from './pages/Tasks';
import Projects from './pages/Projects';
import Developers from './pages/Developers';
import Trash from './pages/Trash';
import Reports from './pages/Reports';
import Admins from './pages/Admins';
import MyDashboard from './pages/MyDashboard';

// Where each role lands after signing in
function Home() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'developer' ? '/dashboard' : '/tasks'} replace />;
}

function ProtectedRoute({ children, adminOnly, developerOnly }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  if (developerOnly && user.role !== 'developer') return <Navigate to="/reports" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Home />} />
            <Route path="/dashboard" element={<ProtectedRoute developerOnly><MyDashboard /></ProtectedRoute>} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/projects" element={<ProtectedRoute adminOnly><Projects /></ProtectedRoute>} />
            <Route path="/developers" element={<ProtectedRoute adminOnly><Developers /></ProtectedRoute>} />
            <Route path="/trash" element={<ProtectedRoute adminOnly><Trash /></ProtectedRoute>} />
            <Route path="/admins" element={<ProtectedRoute adminOnly><Admins /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
