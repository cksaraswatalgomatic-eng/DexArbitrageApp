import express from 'express';
import cors from 'cors';
import pino from 'pino';
import path from 'path';
import cron from 'node-cron';
import { pollAndStoreData } from './services/polling';
import apiRoutes from './routes';

const app = express();
const port = process.env.PORT || 8080;

const logger = pino({ transport: { target: 'pino-pretty' } });

// Middleware
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGINS?.split(',') || 'http://localhost:5173' }));

// API Routes
app.use('/api', apiRoutes);
app.get('/healthz', (req, res) => {
  res.status(200).json({ ok: true });
});

// Serve frontend
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
});

// Schedule polling job
cron.schedule(process.env.POLL_INTERVAL_CRON || '*/2 * * * *', () => {
  pollAndStoreData();
});

// Start server
const server = app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});
