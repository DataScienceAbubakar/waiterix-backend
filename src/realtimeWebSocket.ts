/**
 * OpenAI Realtime WebSocket Handler
 * Handles client WebSocket connections and relays audio to/from OpenAI Realtime API
 */

import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import { storage } from './storage';
import { OpenAIRealtimeSession, RealtimeSessionConfig } from './openaiRealtime';

interface RealtimeClientData {
    sessionId: string;
    restaurantId: string;
    openaiSession: OpenAIRealtimeSession | null;
    isAlive: boolean;
}

// Use a Map to store client data instead of extending WebSocket
type RealtimeClient = WebSocket & RealtimeClientData;

class OpenAIRealtimeWebSocketServer {
    private wss: WebSocketServer | null = null;
    private clients: Map<string, RealtimeClient> = new Map();

    /**
     * Initialize the WebSocket server for real-time voice
     */
    initialize(server: Server): void {
        // Create WebSocket server on a specific path to avoid conflicts
        this.wss = new WebSocketServer({
            server,
            path: '/ws/realtime',
        });

        this.wss.on('connection', async (ws: RealtimeClient, req) => {
            const { query } = parse(req.url || '', true);
            const restaurantId = query.restaurantId as string;
            const customerSessionId = query.customerSessionId as string || `session-${Date.now()}`;

            if (!restaurantId) {
                ws.close(1008, 'Missing restaurantId');
                return;
            }

            // Generate unique session ID
            const sessionId = `realtime-${restaurantId}-${customerSessionId}-${Date.now()}`;
            ws.sessionId = sessionId;
            ws.restaurantId = restaurantId;
            ws.openaiSession = null;
            ws.isAlive = true;

            this.clients.set(sessionId, ws);
            console.log(`[Realtime WS] Client connected: ${sessionId}`);

            // Handle messages from client
            ws.on('message', async (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    await this.handleClientMessage(ws, message);
                } catch (error) {
                    console.error('[Realtime WS] Error handling message:', error);
                    this.sendToClient(ws, {
                        type: 'error',
                        error: 'Failed to process message',
                    });
                }
            });

            // Heartbeat
            ws.on('pong', () => {
                ws.isAlive = true;
            });

            // Handle disconnection
            ws.on('close', () => {
                console.log(`[Realtime WS] Client disconnected: ${sessionId}`);

                // Disconnect OpenAI session
                if (ws.openaiSession) {
                    ws.openaiSession.disconnect();
                }

                this.clients.delete(sessionId);
            });

            ws.on('error', (error) => {
                console.error(`[Realtime WS] Client error: ${sessionId}`, error);
            });
        });

        // Heartbeat interval
        const interval = setInterval(() => {
            this.wss?.clients.forEach((ws: WebSocket) => {
                const client = ws as RealtimeClient;
                if (client.isAlive === false) {
                    if (client.openaiSession) {
                        client.openaiSession.disconnect();
                    }
                    return client.terminate();
                }
                client.isAlive = false;
                client.ping();
            });
        }, 30000);

        this.wss.on('close', () => {
            clearInterval(interval);
        });

        console.log('[Realtime WS] OpenAI Realtime WebSocket server initialized on /ws/realtime');
    }

    /**
     * Handle messages from the client
     */
    private async handleClientMessage(client: RealtimeClient, message: any): Promise<void> {
        switch (message.type) {
            case 'start_session':
                await this.startRealtimeSession(client, message);
                break;

            case 'audio':
                // Relay audio to OpenAI
                if (client.openaiSession?.connected) {
                    client.openaiSession.sendAudio(message.audio);
                } else {
                    this.sendToClient(client, {
                        type: 'error',
                        error: 'Session not connected',
                    });
                }
                break;

            case 'commit_audio':
                // Force model to respond
                if (client.openaiSession?.connected) {
                    client.openaiSession.commitAudio();
                }
                break;

            case 'cancel':
                // Cancel current response (user interrupted)
                if (client.openaiSession?.connected) {
                    client.openaiSession.cancelResponse();
                }
                break;

            case 'text':
                // Send text message (fallback for testing)
                if (client.openaiSession?.connected) {
                    client.openaiSession.sendText(message.text);
                }
                break;

            case 'end_session':
                if (client.openaiSession) {
                    client.openaiSession.disconnect();
                    client.openaiSession = null;
                }
                this.sendToClient(client, { type: 'session_ended' });
                break;

            case 'ping':
                this.sendToClient(client, { type: 'pong' });
                break;

            default:
                console.warn('[Realtime WS] Unknown message type:', message.type);
        }
    }

    /**
     * Start a new OpenAI Realtime session
     */
    private async startRealtimeSession(client: RealtimeClient, message: any): Promise<void> {
        try {
            // Check if OpenAI API key is configured
            if (!process.env.OPENAI_API_KEY) {
                this.sendToClient(client, {
                    type: 'error',
                    error: 'OpenAI Realtime API is not configured',
                });
                return;
            }

            // Get restaurant and menu data
            const restaurant = await storage.getRestaurant(client.restaurantId);
            if (!restaurant) {
                this.sendToClient(client, {
                    type: 'error',
                    error: 'Restaurant not found',
                });
                return;
            }

            // Check if AI waiter is enabled for this restaurant
            if (!restaurant.aiWaiterEnabled) {
                this.sendToClient(client, {
                    type: 'error',
                    error: 'AI Waiter is not enabled for this restaurant',
                });
                return;
            }

            const menuItems = await storage.getMenuItems(client.restaurantId);

            // Create session config
            const config: RealtimeSessionConfig = {
                restaurantId: client.restaurantId,
                restaurantName: restaurant.name,
                menuItems: menuItems,
                language: message.language || 'en',
                customerSessionId: client.sessionId,
            };

            // Create OpenAI session with event handlers
            const openaiSession = new OpenAIRealtimeSession(config, {
                onSessionCreated: () => {
                    this.sendToClient(client, { type: 'session_started' });
                },

                onAudioDelta: (audioBase64: string) => {
                    // Relay audio to client
                    this.sendToClient(client, {
                        type: 'audio',
                        audio: audioBase64,
                    });
                },

                onTranscript: (transcript: string, isFinal: boolean) => {
                    this.sendToClient(client, {
                        type: 'transcript',
                        transcript,
                        isFinal,
                        role: 'user',
                    });
                },

                onResponseDone: (response: any) => {
                    this.sendToClient(client, {
                        type: 'response_done',
                        response,
                    });
                },

                onFunctionCall: (name: string, args: any) => {
                    // Notify client about function calls (e.g., add to cart)
                    if (name === 'add_to_cart' && args) {
                        // Find the full menu item
                        const menuItem = menuItems.find(
                            item => item.name.toLowerCase() === args.item_name?.toLowerCase()
                        );

                        if (menuItem) {
                            this.sendToClient(client, {
                                type: 'add_to_cart',
                                item: {
                                    ...menuItem,
                                    quantity: args.quantity || 1,
                                    customerNote: args.special_instructions,
                                },
                            });
                        }
                    }
                },

                onError: (error: string) => {
                    this.sendToClient(client, {
                        type: 'error',
                        error,
                    });
                },
            });

            // Store session on client
            client.openaiSession = openaiSession;

            // Connect to OpenAI
            await openaiSession.connect();

            console.log(`[Realtime WS] OpenAI session started for ${client.sessionId}`);
        } catch (error: any) {
            console.error('[Realtime WS] Error starting session:', error);
            this.sendToClient(client, {
                type: 'error',
                error: `Failed to start session: ${error.message}`,
            });
        }
    }

    /**
     * Send message to client
     */
    private sendToClient(client: RealtimeClient, data: any): void {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    }
}

// Export singleton instance
export const realtimeWebSocketServer = new OpenAIRealtimeWebSocketServer();
