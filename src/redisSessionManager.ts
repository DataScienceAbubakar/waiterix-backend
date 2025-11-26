import Redis from 'ioredis';

// Redis client for session management
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export interface SessionData {
  userId: string;
  email: string;
  restaurantId?: string;
  role?: string;
  createdAt: string;
  lastActivity: string;
  metadata?: Record<string, any>;
}

export class RedisSessionManager {
  private sessionPrefix = 'session:';
  private userSessionsPrefix = 'user_sessions:';
  private defaultTTL = 7 * 24 * 60 * 60; // 7 days in seconds

  // Create a new session
  async createSession(sessionId: string, sessionData: SessionData, ttl?: number): Promise<void> {
    const key = this.sessionPrefix + sessionId;
    const userSessionsKey = this.userSessionsPrefix + sessionData.userId;
    
    try {
      // Store session data
      await redis.setex(key, ttl || this.defaultTTL, JSON.stringify(sessionData));
      
      // Add session to user's session set (for tracking multiple sessions)
      await redis.sadd(userSessionsKey, sessionId);
      await redis.expire(userSessionsKey, ttl || this.defaultTTL);
      
      console.log(`Session created: ${sessionId} for user ${sessionData.userId}`);
    } catch (error) {
      console.error('Error creating session:', error);
      throw new Error('Failed to create session');
    }
  }

  // Get session data
  async getSession(sessionId: string): Promise<SessionData | null> {
    const key = this.sessionPrefix + sessionId;
    
    try {
      const sessionData = await redis.get(key);
      
      if (!sessionData) {
        return null;
      }
      
      const parsed = JSON.parse(sessionData) as SessionData;
      
      // Update last activity
      parsed.lastActivity = new Date().toISOString();
      await redis.setex(key, this.defaultTTL, JSON.stringify(parsed));
      
      return parsed;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  // Update session data
  async updateSession(sessionId: string, updates: Partial<SessionData>, ttl?: number): Promise<boolean> {
    const key = this.sessionPrefix + sessionId;
    
    try {
      const existingData = await redis.get(key);
      
      if (!existingData) {
        return false;
      }
      
      const sessionData = JSON.parse(existingData) as SessionData;
      const updatedData = {
        ...sessionData,
        ...updates,
        lastActivity: new Date().toISOString(),
      };
      
      await redis.setex(key, ttl || this.defaultTTL, JSON.stringify(updatedData));
      
      console.log(`Session updated: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('Error updating session:', error);
      return false;
    }
  }

  // Delete a session
  async deleteSession(sessionId: string): Promise<boolean> {
    const key = this.sessionPrefix + sessionId;
    
    try {
      // Get session data to find user ID
      const sessionData = await redis.get(key);
      
      if (sessionData) {
        const parsed = JSON.parse(sessionData) as SessionData;
        const userSessionsKey = this.userSessionsPrefix + parsed.userId;
        
        // Remove session from user's session set
        await redis.srem(userSessionsKey, sessionId);
      }
      
      // Delete the session
      const result = await redis.del(key);
      
      console.log(`Session deleted: ${sessionId}`);
      return result > 0;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  // Get all sessions for a user
  async getUserSessions(userId: string): Promise<string[]> {
    const userSessionsKey = this.userSessionsPrefix + userId;
    
    try {
      const sessionIds = await redis.smembers(userSessionsKey);
      return sessionIds;
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }

  // Delete all sessions for a user
  async deleteUserSessions(userId: string): Promise<void> {
    const userSessionsKey = this.userSessionsPrefix + userId;
    
    try {
      const sessionIds = await redis.smembers(userSessionsKey);
      
      if (sessionIds.length > 0) {
        // Delete all session keys
        const sessionKeys = sessionIds.map(id => this.sessionPrefix + id);
        await redis.del(...sessionKeys);
        
        // Delete user sessions set
        await redis.del(userSessionsKey);
        
        console.log(`Deleted ${sessionIds.length} sessions for user ${userId}`);
      }
    } catch (error) {
      console.error('Error deleting user sessions:', error);
      throw new Error('Failed to delete user sessions');
    }
  }

  // Extend session TTL
  async extendSession(sessionId: string, ttl?: number): Promise<boolean> {
    const key = this.sessionPrefix + sessionId;
    
    try {
      const result = await redis.expire(key, ttl || this.defaultTTL);
      return result === 1;
    } catch (error) {
      console.error('Error extending session:', error);
      return false;
    }
  }

  // Check if session exists
  async sessionExists(sessionId: string): Promise<boolean> {
    const key = this.sessionPrefix + sessionId;
    
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Error checking session existence:', error);
      return false;
    }
  }

  // Clean up expired sessions (manual cleanup if needed)
  async cleanupExpiredSessions(): Promise<void> {
    try {
      // Get all session keys
      const sessionKeys = await redis.keys(this.sessionPrefix + '*');
      
      let cleanedCount = 0;
      
      for (const key of sessionKeys) {
        const ttl = await redis.ttl(key);
        
        // If TTL is -1 (no expiration) or -2 (key doesn't exist), handle appropriately
        if (ttl === -2) {
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} expired sessions`);
      }
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
    }
  }

  // Get session statistics
  async getSessionStats(): Promise<{ totalSessions: number; activeUsers: number }> {
    try {
      const sessionKeys = await redis.keys(this.sessionPrefix + '*');
      const userSessionKeys = await redis.keys(this.userSessionsPrefix + '*');
      
      return {
        totalSessions: sessionKeys.length,
        activeUsers: userSessionKeys.length,
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      return { totalSessions: 0, activeUsers: 0 };
    }
  }

  // Store temporary data (like verification codes)
  async setTemporaryData(key: string, data: any, ttlSeconds: number): Promise<void> {
    try {
      await redis.setex(`temp:${key}`, ttlSeconds, JSON.stringify(data));
    } catch (error) {
      console.error('Error setting temporary data:', error);
      throw new Error('Failed to store temporary data');
    }
  }

  // Get temporary data
  async getTemporaryData(key: string): Promise<any | null> {
    try {
      const data = await redis.get(`temp:${key}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error getting temporary data:', error);
      return null;
    }
  }

  // Delete temporary data
  async deleteTemporaryData(key: string): Promise<boolean> {
    try {
      const result = await redis.del(`temp:${key}`);
      return result > 0;
    } catch (error) {
      console.error('Error deleting temporary data:', error);
      return false;
    }
  }

  // Close Redis connection (for graceful shutdown)
  async close(): Promise<void> {
    try {
      await redis.quit();
      console.log('Redis connection closed');
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

// Export singleton instance
export const redisSessionManager = new RedisSessionManager();

// Export Redis client for direct access if needed
export { redis };