import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { syncRoutes } from './routes/sync';
import { licenseRoutes } from './routes/license';
import { configRoutes } from './routes/config';
import { authMiddleware } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser requests (e.g., server-to-server) without origin
    if (!origin) return cb(null, true);

    const allowed = [
      /^chrome-extension:\/\/.+/i,
      /^https:\/\/.*\.devcontext\.app$/i,
      /^http:\/\/localhost(?::\d+)?$/i
    ];

    const ok = allowed.some((r) => r.test(origin));
    cb(null, ok);
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
app.use(rateLimiter);

// Root endpoint
app.get('/', (_, res) => {
  res.json({
    name: 'DevContext Sync API',
    version: '0.1.0',
    endpoints: {
      health: '/health',
      config: '/config',
      license: '/api/v1/license',
      sync: '/api/v1/sync'
    }
  });
});

// Health check with database connectivity
app.get('/health', async (_, res) => {
  try {
    // Import db inline to avoid circular dependency issues
    const { db } = await import('./db');
    const { sql } = await import('drizzle-orm');

    // Quick database ping
    await db.execute(sql`SELECT 1`);

    res.json({
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes
app.use('/api/v1/license', licenseRoutes);
app.use('/api/v1/sync', authMiddleware, syncRoutes);
app.use('/config', configRoutes); // Public config endpoint (no auth required)

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`DevContext Sync backend running on port ${PORT}`);
});

export default app;
