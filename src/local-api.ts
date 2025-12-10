import "./env-loader";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { getGatewayStatus } from "./payments";
import path from "path";

function log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

const app = express();

app.use(express.json({
    limit: '50mb',
    verify: (req: any, res, buf) => {
        if (req.url?.startsWith('/api/webhooks/')) {
            req.rawBody = buf.toString('utf8');
        }
    }
}));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

app.use('/attached_assets', express.static(path.resolve(process.cwd(), 'attached_assets')));

app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
        capturedJsonResponse = bodyJson;
        return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
        const duration = Date.now() - start;
        if (path.startsWith("/api")) {
            let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
            if (capturedJsonResponse) {
                logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
            }
            if (logLine.length > 80) {
                logLine = logLine.slice(0, 79) + "…";
            }
            log(logLine);
        }
    });

    next();
});

const mockUser = {
    id: 'mock-user-id-123',
    email: 'test_local_debug@example.com',
    firstName: 'Test',
    lastName: 'User',
    profileImageUrl: 'https://ui-avatars.com/api/?name=Test+User',
    acceptedTerms: true,
    acceptedTermsAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

// Mock Auth Routes
app.post('/api/auth/verify', (req, res) => {
    log('[Mock Auth] Verifying user token...');
    // Simulate network delay
    setTimeout(() => {
        log('[Mock Auth] User verified successfully');
        res.json({ user: mockUser });
    }, 500);
});

app.get('/api/auth/user', (req, res) => {
    log('[Mock Auth] Fetching current user...');
    res.json(mockUser);
});

app.post('/api/auth/logout', (req, res) => {
    log('[Mock Auth] Logging out...');
    res.json({ message: "Logged out" });
});

app.get('/test-db', async (req, res) => {
    try {
        // @ts-ignore
        const { pool } = await import("./db");
        const result = await pool.query('SELECT NOW()');
        res.json(result.rows);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

(async () => {
    const server = await registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        res.status(status).json({ message });
        throw err;
    });

    const port = 3005;
    server.listen({
        port,
        host: "127.0.0.1",
    }, () => {
        log(`serving on port ${port}`);

        const gatewayStatus = getGatewayStatus();
        log('Payment Gateway Status:');
        Object.entries(gatewayStatus).forEach(([key, value]) => {
            const status = value.configured ? '✓ Configured' : '✗ Not configured';
            log(`  ${value.name} (${value.region}): ${status}`);
        });
    });
})();
