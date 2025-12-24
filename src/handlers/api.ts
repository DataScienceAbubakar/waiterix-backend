import serverless from 'serverless-http';
import express from 'express';
import cors from 'cors';
import { registerRoutes } from '../routes';

// Create Express app
const app = express();

// CORS configuration - Ensure the frontend URL matches exactly
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://main.d182r8qb7g7hdy.amplifyapp.com';

const corsOptions = {
  origin: FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Amz-Date',
    'X-Api-Key',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
    'x-paystack-signature',
    'stripe-signature',
  ],
};

app.use(cors(corsOptions));

// Explicit OPTIONS preflight handler for all routes
app.options('*', cors(corsOptions));

// Add CORS headers to EVERY response as a safety net
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', FRONTEND_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
  next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'waiterix-backend',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Waiterix Backend API',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Async initialization for routes (including session/auth middleware)
let routesInitialized = false;
let initializationPromise: Promise<void> | null = null;

async function initializeApp() {
  if (!routesInitialized) {
    console.log('[Lambda] Initializing routes and auth middleware...');
    await registerRoutes(app);

    // 404 handler - MUST be registered AFTER routes
    app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });

    // Error handling middleware - MUST be registered AFTER routes
    app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', error);

      res.status(error.status || 500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    });

    routesInitialized = true;
    console.log('[Lambda] Routes initialized successfully');
  }
}

// Start initialization immediately (runs during Lambda cold start)
initializationPromise = initializeApp().catch((error) => {
  console.error('[Lambda] Failed to initialize routes:', error);
  throw error;
});

// Create the serverless handler
const serverlessHandler = serverless(app, {
  binary: ['image/*', 'audio/*', 'video/*', 'application/pdf'],
});

// Export handler that waits for initialization before processing requests
export const handler = async (event: any, context: any) => {
  // Ensure routes are fully initialized before handling any request
  await initializationPromise;
  return serverlessHandler(event, context);
};