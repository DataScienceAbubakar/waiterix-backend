/**
 * Render WebSocket Server for OpenAI Realtime API
 * This is a standalone server designed to be deployed on Render
 * 
 * It handles:
 * - WebSocket connections from the browser
 * - Relays audio to/from OpenAI Realtime API
 * - Function calling for add-to-cart
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import cors from 'cors';
import { parse } from 'url';

const app = express();
const server = createServer(app);

// CORS for health checks
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
}));

app.use(express.json());

// Health check endpoint (required by Render)
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.json({
        service: 'Waiterix Realtime WebSocket Server',
        status: 'running',
        version: '1.0.0'
    });
});

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws/realtime' });

// Store OpenAI connections per client
interface ClientConnection {
    openaiWs: WebSocket | null;
    restaurantId: string;
    language: string;
    menuItems: any[];
}

const clients = new Map<WebSocket, ClientConnection>();

// OpenAI Realtime configuration
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

function log(message: string, ...args: any[]) {
    console.log(`[${new Date().toISOString()}] ${message}`, ...args);
}

/**
 * Create system prompt for AI waiter
 */
function createSystemPrompt(restaurantName: string, menuItems: any[], language: string): string {
    const menuList = menuItems
        .filter(item => item.available !== false)
        .map(item => `- ${item.name} ($${item.price}): ${item.description || 'No description'}`)
        .join('\n');

    return `You are a friendly, helpful AI waiter at ${restaurantName || 'this restaurant'}. 

Your personality:
- Warm, welcoming, and conversational
- Knowledgeable about the menu and eager to help
- Speak naturally like a real waiter would
- Keep responses concise (1-2 sentences when possible)
- Be enthusiastic about recommendations

Your capabilities:
- Help customers explore the menu
- Answer questions about dishes, ingredients, allergens
- Make personalized recommendations
- Add items to their cart when they're ready to order

Menu Items Available:
${menuList || 'Menu items will be provided by the restaurant.'}

Important guidelines:
- When a customer wants to order, use the add_to_cart function
- Always confirm what you're adding to the cart
- Be helpful with dietary restrictions (vegan, vegetarian, halal, kosher)
- If asked about something not on the menu, politely explain it's not available
- Speak in ${language === 'en' ? 'English' : language}

Remember: You're here to make their dining experience delightful!`;
}

/**
 * Connect to OpenAI Realtime API
 */
function connectToOpenAI(clientWs: WebSocket, config: any): WebSocket | null {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        log('ERROR: OPENAI_API_KEY not configured');
        sendToClient(clientWs, { type: 'error', error: 'OpenAI API key not configured on server' });
        return null;
    }

    const url = `${OPENAI_REALTIME_URL}?model=${OPENAI_MODEL}`;
    log(`Connecting to OpenAI Realtime API...`);

    const openaiWs = new WebSocket(url, {
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'OpenAI-Beta': 'realtime=v1',
        },
    });

    openaiWs.on('open', () => {
        log('Connected to OpenAI Realtime API');

        // Configure session
        const systemPrompt = createSystemPrompt(
            config.restaurantName || 'Restaurant',
            config.menuItems || [],
            config.language || 'en'
        );

        openaiWs.send(JSON.stringify({
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                instructions: systemPrompt,
                voice: 'alloy', // Options: alloy, echo, fable, onyx, nova, shimmer
                input_audio_format: 'pcm16',
                output_audio_format: 'pcm16',
                input_audio_transcription: {
                    model: 'whisper-1',
                },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500,
                },
                tools: [
                    {
                        type: 'function',
                        name: 'add_to_cart',
                        description: 'Add a menu item to the customer\'s cart. Use this when the customer wants to order something.',
                        parameters: {
                            type: 'object',
                            properties: {
                                item_name: {
                                    type: 'string',
                                    description: 'The exact name of the menu item to add',
                                },
                                quantity: {
                                    type: 'integer',
                                    description: 'Number of items to add (default 1)',
                                    default: 1,
                                },
                                special_instructions: {
                                    type: 'string',
                                    description: 'Any special instructions or modifications for the item',
                                },
                            },
                            required: ['item_name'],
                        },
                    },
                ],
                tool_choice: 'auto',
            },
        }));
    });

    openaiWs.on('message', (data: Buffer) => {
        try {
            const event = JSON.parse(data.toString());
            handleOpenAIEvent(clientWs, event, config);
        } catch (error) {
            log('Error parsing OpenAI message:', error);
        }
    });

    openaiWs.on('error', (error) => {
        log('OpenAI WebSocket error:', error);
        sendToClient(clientWs, { type: 'error', error: 'OpenAI connection error' });
    });

    openaiWs.on('close', (code, reason) => {
        log('OpenAI connection closed:', code, reason.toString());
    });

    return openaiWs;
}

/**
 * Handle events from OpenAI
 */
function handleOpenAIEvent(clientWs: WebSocket, event: any, config: any) {
    switch (event.type) {
        case 'session.created':
            log('OpenAI session created');
            sendToClient(clientWs, { type: 'session_started' });
            break;

        case 'session.updated':
            log('OpenAI session updated');
            break;

        case 'input_audio_buffer.speech_started':
            log('User started speaking');
            break;

        case 'input_audio_buffer.speech_stopped':
            log('User stopped speaking');
            break;

        case 'conversation.item.input_audio_transcription.completed':
            log('User said:', event.transcript);
            sendToClient(clientWs, {
                type: 'transcript',
                transcript: event.transcript || '',
                role: 'user',
                isFinal: true,
            });
            break;

        case 'response.audio.delta':
            // Stream audio to client
            if (event.delta) {
                sendToClient(clientWs, {
                    type: 'audio',
                    audio: event.delta,
                });
            }
            break;

        case 'response.audio_transcript.done':
            log('AI said:', event.transcript);
            break;

        case 'response.function_call_arguments.done':
            log('Function call:', event.name, event.arguments);
            handleFunctionCall(clientWs, event, config);
            break;

        case 'response.done':
            sendToClient(clientWs, { type: 'response_done', response: event.response });
            break;

        case 'error':
            log('OpenAI error:', event.error);
            sendToClient(clientWs, { type: 'error', error: event.error?.message || 'Unknown error' });
            break;

        default:
            // Ignore rate_limits and other non-essential events
            if (!event.type.startsWith('rate_limits')) {
                // log('Unhandled OpenAI event:', event.type);
            }
    }
}

/**
 * Handle function calls from OpenAI
 */
function handleFunctionCall(clientWs: WebSocket, event: any, config: any) {
    if (event.name !== 'add_to_cart') return;

    try {
        const args = JSON.parse(event.arguments || '{}');

        // Find the menu item
        const menuItems = config.menuItems || [];
        const menuItem = menuItems.find(
            (item: any) => item.name.toLowerCase() === args.item_name?.toLowerCase()
        );

        if (menuItem) {
            // Notify client to add item to cart
            sendToClient(clientWs, {
                type: 'add_to_cart',
                item: {
                    ...menuItem,
                    quantity: args.quantity || 1,
                    customerNote: args.special_instructions,
                },
            });

            // Respond to OpenAI with success
            const clientData = clients.get(clientWs);
            if (clientData?.openaiWs?.readyState === WebSocket.OPEN) {
                clientData.openaiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: event.call_id,
                        output: JSON.stringify({
                            success: true,
                            message: `Added ${args.quantity || 1} ${menuItem.name} to cart`,
                        }),
                    },
                }));
                clientData.openaiWs.send(JSON.stringify({ type: 'response.create' }));
            }
        } else {
            // Item not found
            const clientData = clients.get(clientWs);
            if (clientData?.openaiWs?.readyState === WebSocket.OPEN) {
                clientData.openaiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: event.call_id,
                        output: JSON.stringify({
                            success: false,
                            message: `Could not find "${args.item_name}" on the menu`,
                        }),
                    },
                }));
                clientData.openaiWs.send(JSON.stringify({ type: 'response.create' }));
            }
        }
    } catch (error) {
        log('Error handling function call:', error);
    }
}

/**
 * Send message to client
 */
function sendToClient(ws: WebSocket, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// Handle WebSocket connections
wss.on('connection', (ws: WebSocket, req) => {
    const { query } = parse(req.url || '', true);
    const restaurantId = query.restaurantId as string;

    if (!restaurantId) {
        ws.close(1008, 'Missing restaurantId');
        return;
    }

    log(`Client connected for restaurant: ${restaurantId}`);

    // Initialize client data
    clients.set(ws, {
        openaiWs: null,
        restaurantId,
        language: 'en',
        menuItems: [],
    });

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
        try {
            const message = JSON.parse(data.toString());
            handleClientMessage(ws, message);
        } catch (error) {
            log('Error parsing client message:', error);
        }
    });

    // Handle disconnect
    ws.on('close', () => {
        log(`Client disconnected for restaurant: ${restaurantId}`);
        const clientData = clients.get(ws);
        if (clientData?.openaiWs) {
            clientData.openaiWs.close();
        }
        clients.delete(ws);
    });

    ws.on('error', (error) => {
        log('Client WebSocket error:', error);
    });
});

/**
 * Handle messages from client
 */
function handleClientMessage(ws: WebSocket, message: any) {
    const clientData = clients.get(ws);
    if (!clientData) return;

    switch (message.type) {
        case 'start_session':
            log('Starting OpenAI session');
            // Store config
            clientData.language = message.language || 'en';
            clientData.menuItems = message.menuItems || [];

            // Connect to OpenAI
            const openaiWs = connectToOpenAI(ws, {
                restaurantId: clientData.restaurantId,
                restaurantName: message.restaurantName,
                language: clientData.language,
                menuItems: clientData.menuItems,
            });
            clientData.openaiWs = openaiWs;
            break;

        case 'audio':
            // Relay audio to OpenAI
            if (clientData.openaiWs?.readyState === WebSocket.OPEN && message.audio) {
                clientData.openaiWs.send(JSON.stringify({
                    type: 'input_audio_buffer.append',
                    audio: message.audio,
                }));
            }
            break;

        case 'commit_audio':
            if (clientData.openaiWs?.readyState === WebSocket.OPEN) {
                clientData.openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                clientData.openaiWs.send(JSON.stringify({ type: 'response.create' }));
            }
            break;

        case 'cancel':
            if (clientData.openaiWs?.readyState === WebSocket.OPEN) {
                clientData.openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
            }
            break;

        case 'end_session':
            if (clientData.openaiWs) {
                clientData.openaiWs.close();
                clientData.openaiWs = null;
            }
            sendToClient(ws, { type: 'session_ended' });
            break;

        case 'ping':
            sendToClient(ws, { type: 'pong' });
            break;

        default:
            log('Unknown message type:', message.type);
    }
}

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    log(`🚀 Waiterix Realtime WebSocket Server running on port ${PORT}`);
    log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws/realtime`);
    log(`❤️  Health check: http://localhost:${PORT}/health`);
});
