/**
 * OpenAI Realtime API Service
 * Handles WebSocket connections to OpenAI for real-time voice conversations
 */

import WebSocket from 'ws';

// OpenAI Realtime API endpoint
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

export interface RealtimeSessionConfig {
    restaurantId: string;
    restaurantName: string;
    menuItems: any[];
    language: string;
    customerSessionId: string;
}

export interface RealtimeEventHandlers {
    onAudioDelta: (audioBase64: string) => void;
    onTranscript: (transcript: string, isFinal: boolean) => void;
    onResponseDone: (response: any) => void;
    onFunctionCall: (name: string, args: any) => void;
    onError: (error: string) => void;
    onSessionCreated: () => void;
}

/**
 * Creates a system prompt for the AI waiter
 */
function createSystemPrompt(config: RealtimeSessionConfig): string {
    const menuItemsList = config.menuItems
        .filter(item => item.available)
        .map(item => `- ${item.name} ($${item.price}): ${item.description || 'No description'}`)
        .join('\n');

    return `You are a friendly, helpful AI waiter at ${config.restaurantName}. 

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
${menuItemsList}

Important guidelines:
- When a customer wants to order, use the add_to_cart function
- Always confirm what you're adding to the cart
- Be helpful with dietary restrictions (vegan, vegetarian, halal, kosher)
- If asked about something not on the menu, politely explain it's not available
- Speak in ${config.language === 'en' ? 'English' : config.language}

Remember: You're here to make their dining experience delightful!`;
}

/**
 * OpenAI Realtime Session Manager
 * Manages a single real-time voice session with OpenAI
 */
export class OpenAIRealtimeSession {
    private ws: WebSocket | null = null;
    private config: RealtimeSessionConfig;
    private handlers: RealtimeEventHandlers;
    private isConnected: boolean = false;
    private sessionId: string | null = null;

    constructor(config: RealtimeSessionConfig, handlers: RealtimeEventHandlers) {
        this.config = config;
        this.handlers = handlers;
    }

    /**
     * Connect to OpenAI Realtime API
     */
    async connect(): Promise<void> {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY is not configured');
        }

        return new Promise((resolve, reject) => {
            const url = `${OPENAI_REALTIME_URL}?model=${OPENAI_MODEL}`;

            this.ws = new WebSocket(url, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'OpenAI-Beta': 'realtime=v1',
                },
            });

            this.ws.on('open', () => {
                console.log('[OpenAI Realtime] Connected to OpenAI');
                this.isConnected = true;
                this.configureSession();
                resolve();
            });

            this.ws.on('message', (data) => {
                this.handleServerEvent(JSON.parse(data.toString()));
            });

            this.ws.on('error', (error) => {
                console.error('[OpenAI Realtime] WebSocket error:', error);
                this.handlers.onError(`Connection error: ${error.message}`);
                reject(error);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`[OpenAI Realtime] Connection closed: ${code} - ${reason}`);
                this.isConnected = false;
            });
        });
    }

    /**
     * Configure the session with system prompt and tools
     */
    private configureSession(): void {
        const systemPrompt = createSystemPrompt(this.config);

        // Send session configuration
        this.sendEvent('session.update', {
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
                    silence_duration_ms: 500, // How long to wait after user stops speaking
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
        });
    }

    /**
     * Send an event to OpenAI
     */
    private sendEvent(type: string, data: any = {}): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.error('[OpenAI Realtime] Cannot send event - not connected');
            return;
        }

        const event = {
            type,
            ...data,
        };

        this.ws.send(JSON.stringify(event));
    }

    /**
     * Handle events from OpenAI server
     */
    private handleServerEvent(event: any): void {
        switch (event.type) {
            case 'session.created':
                this.sessionId = event.session?.id;
                console.log('[OpenAI Realtime] Session created:', this.sessionId);
                this.handlers.onSessionCreated();
                break;

            case 'session.updated':
                console.log('[OpenAI Realtime] Session updated');
                break;

            case 'input_audio_buffer.speech_started':
                console.log('[OpenAI Realtime] User started speaking');
                break;

            case 'input_audio_buffer.speech_stopped':
                console.log('[OpenAI Realtime] User stopped speaking');
                break;

            case 'conversation.item.input_audio_transcription.completed':
                // User's speech transcription
                this.handlers.onTranscript(event.transcript || '', true);
                break;

            case 'response.audio.delta':
                // Streaming audio from AI
                if (event.delta) {
                    this.handlers.onAudioDelta(event.delta);
                }
                break;

            case 'response.audio_transcript.delta':
                // Streaming text transcript of AI response
                // Can be used to show what AI is saying
                break;

            case 'response.audio_transcript.done':
                // Final transcript of AI response
                console.log('[OpenAI Realtime] AI said:', event.transcript);
                break;

            case 'response.function_call_arguments.done':
                // Function call completed
                console.log('[OpenAI Realtime] Function call:', event.name, event.arguments);
                try {
                    const args = JSON.parse(event.arguments || '{}');
                    this.handlers.onFunctionCall(event.name, args);

                    // Automatically respond to the function call
                    this.respondToFunctionCall(event.call_id, event.name, args);
                } catch (error) {
                    console.error('[OpenAI Realtime] Error parsing function arguments:', error);
                }
                break;

            case 'response.done':
                this.handlers.onResponseDone(event.response);
                break;

            case 'error':
                console.error('[OpenAI Realtime] Error from server:', event.error);
                this.handlers.onError(event.error?.message || 'Unknown error');
                break;

            default:
                // Log unhandled events for debugging
                if (!event.type.startsWith('rate_limits')) {
                    console.log('[OpenAI Realtime] Unhandled event:', event.type);
                }
        }
    }

    /**
     * Respond to a function call
     */
    private respondToFunctionCall(callId: string, name: string, args: any): void {
        let result: any = { success: true };

        if (name === 'add_to_cart') {
            // Find the menu item
            const menuItem = this.config.menuItems.find(
                item => item.name.toLowerCase() === args.item_name.toLowerCase()
            );

            if (menuItem) {
                result = {
                    success: true,
                    item: {
                        id: menuItem.id,
                        name: menuItem.name,
                        price: menuItem.price,
                        quantity: args.quantity || 1,
                        special_instructions: args.special_instructions,
                    },
                    message: `Added ${args.quantity || 1} ${menuItem.name} to cart`,
                };
            } else {
                result = {
                    success: false,
                    message: `Could not find "${args.item_name}" on the menu`,
                };
            }
        }

        // Send function call output
        this.sendEvent('conversation.item.create', {
            item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result),
            },
        });

        // Trigger response generation
        this.sendEvent('response.create');
    }

    /**
     * Send audio data to OpenAI
     * @param audioBase64 Base64 encoded PCM16 audio data
     */
    sendAudio(audioBase64: string): void {
        if (!this.isConnected) {
            console.warn('[OpenAI Realtime] Cannot send audio - not connected');
            return;
        }

        this.sendEvent('input_audio_buffer.append', {
            audio: audioBase64,
        });
    }

    /**
     * Commit the audio buffer and trigger a response
     * Call this when you want to force the model to respond
     */
    commitAudio(): void {
        this.sendEvent('input_audio_buffer.commit');
        this.sendEvent('response.create');
    }

    /**
     * Cancel the current response (e.g., when user interrupts)
     */
    cancelResponse(): void {
        this.sendEvent('response.cancel');
    }

    /**
     * Clear the audio input buffer
     */
    clearAudioBuffer(): void {
        this.sendEvent('input_audio_buffer.clear');
    }

    /**
     * Send a text message (for testing or fallback)
     */
    sendText(text: string): void {
        this.sendEvent('conversation.item.create', {
            item: {
                type: 'message',
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: text,
                    },
                ],
            },
        });
        this.sendEvent('response.create');
    }

    /**
     * Disconnect from OpenAI
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        console.log('[OpenAI Realtime] Disconnected');
    }

    /**
     * Check if connected
     */
    get connected(): boolean {
        return this.isConnected;
    }
}
