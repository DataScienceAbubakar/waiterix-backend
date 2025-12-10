import admin from "firebase-admin";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

let firebaseApp: admin.app.App;

try {
  firebaseApp = admin.initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  });
} catch (error: any) {
  if (error.code === 'app/duplicate-app') {
    firebaseApp = admin.app();
  } else {
    throw error;
  }
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
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
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: sessionTtl,
    },
  });
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

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const userId = (req.session as any).userId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    (req as any).userId = userId;
    next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
  }
};
