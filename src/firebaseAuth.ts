import admin from "firebase-admin";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

let firebaseApp: admin.app.App;

try {
  // Initialize with full service account credentials for Lambda environment
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Private key needs newlines replaced (stored as escaped in env vars)
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  console.log("[Firebase] Initializing with project:", serviceAccount.projectId);
  console.log("[Firebase] Client email:", serviceAccount.clientEmail);

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
  console.log("[Firebase] Admin SDK initialized successfully");
} catch (error: any) {
  if (error.code === 'app/duplicate-app') {
    firebaseApp = admin.app();
  } else {
    console.error("[Firebase] Initialization error:", error);
    throw error;
  }
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);

  // Import the shared pool which already has SSL configured
  const { pool } = require('./db');

  const sessionStore = new pgStore({
    pool: pool, // Use the shared pool from db.ts (already has SSL)
    createTableIfMissing: true, // Auto-create sessions table if it doesn't exist
    ttl: sessionTtl,
    tableName: "sessions",
  });

  return session({
    secret: process.env.SESSION_SECRET || 'firebase-session-secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Enable secure cookies when on HTTPS (Lambda behind API Gateway is always HTTPS)
      secure: true,
      sameSite: 'none' as const,
      maxAge: sessionTtl,
    },
  });
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req: any): string | null {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Verify Firebase ID token and return the user ID
 * Returns null if token is invalid or missing
 */
async function verifyFirebaseToken(token: string): Promise<string | null> {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    console.warn("[AUTH] Firebase token verification failed:", error);
    return null;
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  app.post("/api/auth/verify", async (req, res) => {
    console.log("[AUTH] Received verification request");
    try {
      const { idToken } = req.body;

      if (!idToken) {
        console.log("[AUTH] No token provided");
        return res.status(400).json({ message: "No token provided" });
      }

      console.log("[AUTH] Verifying Firebase token...");
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log("[AUTH] Token verified for user:", decodedToken.uid);

      const user = await storage.upsertUser({
        id: decodedToken.uid,
        email: decodedToken.email || '',
        firstName: decodedToken.name?.split(' ')[0] || '',
        lastName: decodedToken.name?.split(' ').slice(1).join(' ') || '',
        profileImageUrl: decodedToken.picture || '',
      });
      console.log("[AUTH] User upserted:", user.id);

      (req.session as any).userId = user.id;

      req.session.save((err) => {
        if (err) {
          console.error("[AUTH] Session save error:", err);
          return res.status(500).json({ message: "Session save failed" });
        }
        console.log("[AUTH] Session saved successfully for user:", user.id);
        res.json({ user });
      });
    } catch (error) {
      console.error("[AUTH] Token verification error:", error);
      res.status(401).json({ message: "Invalid token" });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
      res.clearCookie("connect.sid", {
        path: "/",
        httpOnly: true,
        secure: true,
      });
      res.json({ message: "Logged out" });
    });
  });
}

/**
 * Authentication middleware that supports both:
 * 1. Session cookie (traditional approach)
 * 2. Firebase ID token in Authorization header (Safari compatibility)
 * 
 * Safari's Intelligent Tracking Prevention (ITP) blocks third-party cookies,
 * including SameSite=None cookies when frontend and backend are on different domains.
 * The Authorization header approach bypasses this limitation.
 */
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // First, try session-based authentication
  const sessionUserId = (req.session as any).userId;

  if (sessionUserId) {
    try {
      const user = await storage.getUser(sessionUserId);
      if (user) {
        (req as any).userId = sessionUserId;
        return next();
      }
    } catch (error) {
      console.warn("[AUTH] Session user lookup failed:", error);
    }
  }

  // If session auth fails, try Bearer token authentication (Safari fallback)
  const bearerToken = extractBearerToken(req);

  if (bearerToken) {
    const tokenUserId = await verifyFirebaseToken(bearerToken);

    if (tokenUserId) {
      try {
        // Verify user exists in our database
        const user = await storage.getUser(tokenUserId);
        if (user) {
          (req as any).userId = tokenUserId;

          // Also update the session for future requests (if cookies start working)
          (req.session as any).userId = tokenUserId;

          return next();
        }
      } catch (error) {
        console.warn("[AUTH] Token user lookup failed:", error);
      }
    }
  }

  // Both authentication methods failed
  return res.status(401).json({ message: "Unauthorized" });
};
