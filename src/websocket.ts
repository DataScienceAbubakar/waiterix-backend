import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse } from 'url';
import { IncomingMessage } from 'http';
import { parse as parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import { storage } from './storage';
import session from 'express-session';
import connectPg from 'connect-pg-simple';

interface WebSocketClient extends WebSocket {
  restaurantId?: string;
  customerSessionId?: string;
  role?: 'customer' | 'chef';
  isAlive?: boolean;
  userId?: string;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Set<WebSocketClient>> = new Map();
  private sessionStore: any;

  initialize(server: Server) {
    // Initialize session store for validating chef connections
    const pgStore = connectPg(session);
    this.sessionStore = new pgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      ttl: 7 * 24 * 60 * 60 * 1000,
      tableName: "sessions",
    });

    // Use a specific path to avoid conflicts with Vite's HMR WebSocket
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      verifyClient: (info, callback) => {
        const { query } = parse(info.req.url || '', true);
        const restaurantId = query.restaurantId as string;
        const role = (query.role as 'customer' | 'chef') || 'customer';

        // Basic validation
        if (!restaurantId) {
          callback(false, 400, 'Missing restaurantId');
          return;
        }

        // Chef role requires authentication
        if (role === 'chef') {
          const cookies = info.req.headers.cookie;
          if (!cookies) {
            callback(false, 401, 'Unauthorized - No session cookie');
            return;
          }

          // Parse cookies to extract session ID
          const parsedCookies = parseCookie(cookies);
          const sessionCookie = parsedCookies['connect.sid'];
          
          if (!sessionCookie) {
            callback(false, 401, 'Unauthorized - No session');
            return;
          }

          // Verify the signed cookie and extract session ID
          const unsigned = unsign(sessionCookie.slice(2), process.env.SESSION_SECRET!);
          if (unsigned === false) {
            callback(false, 401, 'Unauthorized - Invalid session signature');
            return;
          }

          const sessionId = unsigned;

          // Validate session against session store
          this.sessionStore.get(sessionId, (err: any, sessionData: any) => {
            if (err || !sessionData) {
              callback(false, 401, 'Unauthorized - Session not found');
              return;
            }

            // Extract user ID from authenticated session
            const userId = sessionData.passport?.user?.claims?.sub;
            if (!userId) {
              callback(false, 401, 'Unauthorized - No user in session');
              return;
            }

            // Store userId on request object for connection handler to use
            (info.req as any).authenticatedUserId = userId;
            console.log(`WebSocket auth successful for userId: ${userId}`);
            callback(true);
          });
        } else {
          // Customer connections are allowed without authentication
          // They only receive messages for their specific session
          callback(true);
        }
      }
    });

    this.wss.on('connection', async (ws: WebSocketClient, req) => {
      const { query } = parse(req.url || '', true);
      const restaurantId = query.restaurantId as string;
      const customerSessionId = query.customerSessionId as string;
      const role = (query.role as 'customer' | 'chef') || 'customer';
      
      // For chef role, use the authenticated userId from verifyClient (stored on req)
      // For customer role, no userId required
      const userId = role === 'chef' ? (req as any).authenticatedUserId : undefined;

      ws.restaurantId = restaurantId;
      ws.customerSessionId = customerSessionId;
      ws.role = role;
      ws.userId = userId;
      ws.isAlive = true;

      // Additional authorization for chef role - verify restaurant ownership
      if (role === 'chef') {
        if (!userId) {
          ws.close(1008, 'Unauthorized - Missing authenticated user ID');
          console.log('Chef connection rejected: missing authenticated user ID');
          return;
        }

        try {
          const restaurant = await storage.getRestaurant(restaurantId);
          if (!restaurant || restaurant.userId !== userId) {
            ws.close(1008, 'Forbidden - Not restaurant owner');
            console.log(`Chef connection rejected: user ${userId} does not own restaurant ${restaurantId}`);
            return;
          }
        } catch (error) {
          console.error('Error verifying restaurant ownership:', error);
          ws.close(1011, 'Internal error during authorization');
          return;
        }
      }

      // Add client to room
      const roomKey = role === 'chef' ? `chef:${restaurantId}` : `customer:${restaurantId}:${customerSessionId}`;
      if (!this.clients.has(roomKey)) {
        this.clients.set(roomKey, new Set());
      }
      this.clients.get(roomKey)?.add(ws);

      console.log(`WebSocket connected: ${role} for restaurant ${restaurantId}${role === 'chef' ? ` (user: ${userId})` : ''}`);

      // Heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      });

      // Handle disconnection
      ws.on('close', () => {
        this.clients.get(roomKey)?.delete(ws);
        if (this.clients.get(roomKey)?.size === 0) {
          this.clients.delete(roomKey);
        }
        console.log(`WebSocket disconnected: ${role} for restaurant ${restaurantId}`);
      });
    });

    // Heartbeat interval
    const interval = setInterval(() => {
      this.wss?.clients.forEach((ws: WebSocketClient) => {
        if (ws.isAlive === false) {
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    console.log('WebSocket server initialized');
  }

  private handleMessage(ws: WebSocketClient, message: any) {
    switch (message.type) {
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  // Send message to specific client
  private send(ws: WebSocketClient, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Notify chef dashboard about new question
  notifyChefNewQuestion(restaurantId: string, questionData: any) {
    const roomKey = `chef:${restaurantId}`;
    const chefClients = this.clients.get(roomKey);
    
    if (chefClients) {
      chefClients.forEach((client) => {
        this.send(client, {
          type: 'new-question',
          data: questionData,
        });
      });
      console.log(`Notified ${chefClients.size} chef(s) about new question for restaurant ${restaurantId}`);
    }
  }

  // Send chef answer to customer
  sendChefAnswerToCustomer(restaurantId: string, customerSessionId: string, answerData: any) {
    const roomKey = `customer:${restaurantId}:${customerSessionId}`;
    const customerClients = this.clients.get(roomKey);
    
    if (customerClients) {
      customerClients.forEach((client) => {
        this.send(client, {
          type: 'chef-answer',
          data: answerData,
        });
      });
      console.log(`Sent chef answer to customer ${customerSessionId} in restaurant ${restaurantId}`);
    }
  }

  // Broadcast to all clients in a restaurant
  broadcast(restaurantId: string, data: any) {
    const rooms = Array.from(this.clients.keys()).filter(key => 
      key.startsWith(`chef:${restaurantId}`) || key.startsWith(`customer:${restaurantId}`)
    );
    
    rooms.forEach(roomKey => {
      this.clients.get(roomKey)?.forEach(client => {
        this.send(client, data);
      });
    });
  }

  // Notify about order status changes
  notifyOrderStatusChange(restaurantId: string, orderData: any) {
    // Notify chef dashboard
    const chefRoomKey = `chef:${restaurantId}`;
    const chefClients = this.clients.get(chefRoomKey);
    
    if (chefClients) {
      chefClients.forEach((client) => {
        this.send(client, {
          type: 'order-status-changed',
          data: orderData,
        });
      });
    }

    // Also broadcast to all customer sessions in this restaurant (for tracking pages)
    const customerRooms = Array.from(this.clients.keys()).filter(key => 
      key.startsWith(`customer:${restaurantId}:`)
    );
    
    customerRooms.forEach(roomKey => {
      this.clients.get(roomKey)?.forEach(client => {
        this.send(client, {
          type: 'order-status-changed',
          data: orderData,
        });
      });
    });

    console.log(`Notified about order status change for order ${orderData.orderId} in restaurant ${restaurantId}`);
  }

  // Notify chef dashboard about new assistance request
  notifyNewAssistanceRequest(restaurantId: string, requestData: any) {
    const roomKey = `chef:${restaurantId}`;
    const chefClients = this.clients.get(roomKey);
    
    if (chefClients) {
      chefClients.forEach((client) => {
        this.send(client, {
          type: 'new-assistance-request',
          data: requestData,
        });
      });
      console.log(`Notified ${chefClients.size} chef(s) about new assistance request for restaurant ${restaurantId}`);
    }
  }
}

export const wsManager = new WebSocketManager();
