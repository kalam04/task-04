import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { authRouter, requireAdmin, requireAuth } from './auth.js';
import { seedDefaultUser } from './seed.js';
import { checkOverdue } from './activity.js';
import { startAutoBackup } from './backup.js';
import { projectsRouter } from './routes/projects.js';
import { clientsRouter } from './routes/clients.js';
import { developersRouter } from './routes/developers.js';
import { tasksRouter } from './routes/tasks.js';
import { trashRouter } from './routes/trash.js';
import { notificationsRouter } from './routes/notifications.js';
import { reportsRouter } from './routes/reports.js';

const isProduction = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET || (isProduction && process.env.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET is missing or too short (use at least 32 random characters). See .env.example');
  process.exit(1);
}

seedDefaultUser();

const app = express();
app.disable('x-powered-by');
// Behind Nginx/a load balancer, trust it for the client IP (used by login protection)
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
// In production the app and API share one origin, so cross-origin requests are only allowed if configured
app.use(cors({ origin: process.env.CORS_ORIGIN || !isProduction }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/clients', requireAuth, clientsRouter);
app.use('/api/developers', requireAuth, developersRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/reports', requireAuth, requireAdmin, reportsRouter);
app.use('/api/trash', requireAuth, requireAdmin, trashRouter);
app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));

// Serve the built frontend (npm run build) so the whole app runs on one port
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// Unexpected errors: log them, don't leak details to the browser
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ message: 'Something went wrong on the server' });
});

checkOverdue();
setInterval(checkOverdue, 3600_000).unref();
startAutoBackup();

const port = process.env.PORT || 4000;
app.listen(port, (err) => {
  if (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use` : err);
    process.exit(1);
  }
  console.log(`API running on http://localhost:${port}${fs.existsSync(distDir) ? ' (serving the built app)' : ''}`);
});
