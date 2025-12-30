/**
 * VAPI Webhook Handler
 * 
 * This module handles incoming webhooks from VAPI for function calls.
 * It integrates with the existing database storage to process orders,
 * pending questions, and assistance requests.
 */

import { Express, Request, Response } from 'express';
import { IStorage } from './storage';
import { calculateSalesTax } from './shared/salesTax';
import { insertOrderSchema, insertOrderItemSchema, insertPendingQuestionSchema } from './shared/schema';

// WebSocket managers for real-time notifications
let wsManager: any = null;
let apiGatewayWebSocketManager: any = null;

export function setVapiWebSocketManagers(ws: any, apiGw: any) {
    wsManager = ws;
    apiGatewayWebSocketManager = apiGw;
}

interface VapiCallMetadata {
    restaurantId?: string;
    tableId?: string;
    tableNumber?: string;
    restaurantState?: string;
    sessionId?: string;
}

interface VapiFunctionCallRequest {
    type: string;
    functionCall: {
        name: string;
        parameters: any;
    };
    call?: {
        id: string;
        assistantOverrides?: {
            variableValues?: VapiCallMetadata;
        };
    };
}

/**
 * Register VAPI webhook routes
 */
export function registerVapiWebhookRoutes(app: Express, storage: IStorage) {

    /**
     * Main VAPI webhook endpoint for function calls
     * This is called by VAPI when the AI triggers a function
     */
    app.post('/api/vapi/webhook', async (req: Request, res: Response) => {
        try {
            const body = req.body as VapiFunctionCallRequest;
            const { type, functionCall, call } = body;

            console.log('[VAPI Webhook] Received:', type, functionCall?.name);

            // Extract metadata from call context
            const metadata: VapiCallMetadata = call?.assistantOverrides?.variableValues || {};
            const { restaurantId, tableId, tableNumber, restaurantState, sessionId } = metadata;

            // Handle function calls
            if (type === 'function-call' && functionCall) {
                const { name, parameters } = functionCall;

                switch (name) {
                    case 'add_to_cart':
                        return handleAddToCart(res, parameters);

                    case 'remove_from_cart':
                        return handleRemoveFromCart(res, parameters);

                    case 'confirm_order':
                        return await handleConfirmOrder(res, parameters, {
                            restaurantId,
                            tableId,
                            tableNumber,
                            restaurantState,
                        }, storage);

                    case 'call_chef':
                        return await handleCallChef(res, parameters, {
                            restaurantId,
                            tableNumber,
                            sessionId: sessionId || call?.id,
                        }, storage);

                    case 'call_waiter':
                        return await handleCallWaiter(res, parameters, {
                            restaurantId,
                            tableId,
                        }, storage);

                    case 'open_checkout':
                        return handleOpenCheckout(res, parameters);

                    default:
                        console.log('[VAPI Webhook] Unknown function:', name);
                        return res.json({
                            result: {
                                success: false,
                                message: `Unknown function: ${name}`
                            }
                        });
                }
            }

            // Handle other VAPI event types
            if (type === 'assistant-request') {
                // VAPI is requesting assistant configuration
                // You can return dynamic assistant config here if needed
                return res.json({ status: 'ok' });
            }

            if (type === 'status-update') {
                // Call status updates (call-started, call-ended, etc.)
                console.log('[VAPI Webhook] Status update:', body);
                return res.json({ status: 'ok' });
            }

            if (type === 'transcript') {
                // Transcript updates - useful for logging
                console.log('[VAPI Webhook] Transcript:', body);
                return res.json({ status: 'ok' });
            }

            // Default response for unhandled types
            res.json({ status: 'ok' });
        } catch (error) {
            console.error('[VAPI Webhook] Error:', error);
            res.status(500).json({
                result: {
                    success: false,
                    message: 'Internal server error'
                }
            });
        }
    });

    /**
     * VAPI webhook for server URL configuration
     * Returns dynamic assistant configuration based on restaurant
     */
    app.post('/api/vapi/assistant-config', async (req: Request, res: Response) => {
        try {
            const { restaurantId } = req.body;

            if (!restaurantId) {
                return res.status(400).json({ error: 'restaurantId required' });
            }

            // Fetch restaurant data
            const restaurant = await storage.getRestaurant(restaurantId);
            if (!restaurant) {
                return res.status(404).json({ error: 'Restaurant not found' });
            }

            // Fetch menu items
            const menuItems = await storage.getMenuItems(restaurantId);

            // Build menu list for system prompt
            const menuList = menuItems
                .filter((item: any) => item.available !== false)
                .map((item: any) => {
                    let details = `- ${item.name} ($${item.price}): ${item.description || 'No description'}`;
                    const tags = [];
                    if (item.isVegan) tags.push('Vegan');
                    if (item.isVegetarian) tags.push('Vegetarian');
                    if (item.isGlutenFree) tags.push('Gluten-Free');
                    if (item.isHalal) tags.push('Halal');
                    if (item.isKosher) tags.push('Kosher');
                    if (tags.length > 0) details += ` [${tags.join(', ')}]`;
                    if (item.allergens && Array.isArray(item.allergens) && item.allergens.length > 0) {
                        details += ` - ALLERGENS: ${item.allergens.join(', ')}`;
                    }
                    return details;
                })
                .join('\n');

            res.json({
                restaurantName: restaurant.name,
                restaurantState: restaurant.state,
                menuItems: menuList,
                restaurantDescription: restaurant.description,
                restaurantHours: restaurant.hours,
                restaurantPhone: restaurant.phone,
                restaurantAddress: restaurant.address,
            });
        } catch (error) {
            console.error('[VAPI Assistant Config] Error:', error);
            res.status(500).json({ error: 'Failed to get assistant config' });
        }
    });

    console.log('[VAPI] Webhook routes registered at /api/vapi/webhook');
}

/**
 * Handle add_to_cart function
 * Note: This is processed client-side, we just return success
 */
function handleAddToCart(res: Response, parameters: any) {
    const { items } = parameters;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.json({
            result: {
                success: false,
                message: 'No items provided'
            }
        });
    }

    // Items are added to cart on the frontend
    // We just confirm the action here
    const itemNames = items.map((i: any) => `${i.quantity || 1}x ${i.item_name}`).join(', ');

    return res.json({
        result: {
            success: true,
            action: 'add_to_cart',
            items: items,
            message: `Added to cart: ${itemNames}. Ask the customer if they would like anything else.`
        }
    });
}

/**
 * Handle remove_from_cart function
 */
function handleRemoveFromCart(res: Response, parameters: any) {
    const { items } = parameters;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.json({
            result: {
                success: false,
                message: 'No items specified for removal'
            }
        });
    }

    const itemNames = items.map((i: any) => i.item_name).join(', ');

    return res.json({
        result: {
            success: true,
            action: 'remove_from_cart',
            items: items,
            message: `Removed from cart: ${itemNames}. Is there anything else you'd like to change?`
        }
    });
}

/**
 * Handle confirm_order function - places the order in the database
 */
async function handleConfirmOrder(
    res: Response,
    parameters: any,
    context: { restaurantId?: string; tableId?: string; tableNumber?: string; restaurantState?: string },
    storage: IStorage
) {
    const { restaurantId, tableId, tableNumber, restaurantState } = context;
    const { payment_method, table_number, customer_note, tip_amount, allergies, cart_items, cart_total } = parameters;

    console.log('[VAPI confirm_order] Context:', JSON.stringify(context));
    console.log('[VAPI confirm_order] Parameters:', JSON.stringify(parameters));
    console.log('[VAPI confirm_order] Cart items count:', cart_items?.length);

    if (!restaurantId) {
        console.log('[VAPI confirm_order] Error: No restaurantId');
        return res.json({
            result: {
                success: false,
                message: 'Restaurant context not found. Please try again.'
            }
        });
    }

    if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
        console.log('[VAPI confirm_order] Error: Empty cart');
        return res.json({
            result: {
                success: false,
                message: 'The cart is empty. Please add items before placing an order.'
            }
        });
    }

    try {
        // Check restaurant subscription status
        const restaurant = await storage.getRestaurant(restaurantId);
        if (!restaurant) {
            return res.json({
                result: {
                    success: false,
                    message: 'Restaurant not found. Please try again.'
                }
            });
        }

        const validStatuses = ['trialing', 'active'];
        if (!restaurant.subscriptionStatus || !validStatuses.includes(restaurant.subscriptionStatus)) {
            return res.json({
                result: {
                    success: false,
                    message: 'Sorry, this restaurant is not currently accepting orders. Please speak with the staff directly.'
                }
            });
        }

        // Calculate totals
        const subtotal = cart_items.reduce((sum: number, item: any) =>
            sum + (parseFloat(item.price) * (item.quantity || 1)), 0
        );
        const tax = calculateSalesTax(subtotal, restaurantState);
        const tip = parseFloat(tip_amount) || 0;
        const total = subtotal + tax + tip;

        // Validate table if provided
        let validatedTableId = null;
        const resolvedTableNumber = table_number || tableNumber;

        console.log('[VAPI confirm_order] Table context:', { tableId, tableNumber, table_number, resolvedTableNumber });

        if (tableId) {
            const table = await storage.getRestaurantTable(tableId);
            console.log('[VAPI confirm_order] Found table by ID:', table?.id, table?.tableNumber);
            if (table && table.restaurantId === restaurantId) {
                validatedTableId = table.id;
            }
        } else if (resolvedTableNumber) {
            const table = await storage.getTableByNumber(restaurantId, resolvedTableNumber);
            console.log('[VAPI confirm_order] Found table by number:', table?.id, table?.tableNumber);
            if (table) {
                validatedTableId = table.id;
            }
        }

        console.log('[VAPI confirm_order] Validated table ID:', validatedTableId);

        // Create order
        const orderData = insertOrderSchema.parse({
            restaurantId,
            tableId: validatedTableId,
            subtotal: subtotal.toFixed(2),
            tax: tax.toFixed(2),
            tip: tip.toFixed(2),
            total: total.toFixed(2),
            paymentMethod: payment_method || 'cash',
            customerNote: customer_note || null,
            paymentStatus: 'pending',
            allergies: allergies || null,
        });

        const orderItemsData = cart_items.map((item: any) =>
            insertOrderItemSchema.parse({
                menuItemId: item.id,
                name: item.name,
                price: parseFloat(item.price).toFixed(2),
                quantity: item.quantity || 1,
                customerNote: item.customerNote || item.special_instructions,
                allergies: item.allergies,
            })
        );

        const order = await storage.createOrder(orderData, orderItemsData);

        // Notify via WebSocket
        if (wsManager) {
            wsManager.notifyNewOrder(restaurantId, order);
        }
        if (apiGatewayWebSocketManager) {
            await apiGatewayWebSocketManager.notifyNewOrder(restaurantId, order);
        }

        const itemsSummary = cart_items
            .map((item: any) => `${item.quantity || 1}x ${item.name}`)
            .join(', ');

        return res.json({
            result: {
                success: true,
                action: 'order_confirmed',
                orderId: order.id,
                order_id_short: order.id.slice(0, 8).toUpperCase(),
                items_ordered: itemsSummary,
                subtotal: `$${subtotal.toFixed(2)}`,
                tax: `$${tax.toFixed(2)}`,
                tip: `$${tip.toFixed(2)}`,
                total: `$${total.toFixed(2)}`,
                payment_method: payment_method || 'cash',
                estimated_wait: '15-20 minutes',
                message: `Order placed successfully! Your order number is ${order.id.slice(0, 8).toUpperCase()}. Total: $${total.toFixed(2)}. Estimated wait time: 15-20 minutes.`
            }
        });
    } catch (error: any) {
        console.error('[VAPI] Error placing order:', error);
        console.error('[VAPI] Error details:', {
            name: error?.name,
            message: error?.message,
            stack: error?.stack,
            cause: error?.cause,
        });
        return res.json({
            result: {
                success: false,
                message: `Sorry, there was an issue placing your order. Error: ${error?.message || 'Unknown error'}. Please try again or speak with the staff.`
            }
        });
    }
}

/**
 * Handle call_chef function - creates a pending question for the kitchen
 */
async function handleCallChef(
    res: Response,
    parameters: any,
    context: { restaurantId?: string; tableNumber?: string; sessionId?: string },
    storage: IStorage
) {
    const { restaurantId, tableNumber, sessionId } = context;
    const { message } = parameters;

    if (!restaurantId) {
        return res.json({
            result: {
                success: false,
                message: 'Restaurant context not found.'
            }
        });
    }

    if (!message) {
        return res.json({
            result: {
                success: false,
                message: 'Please provide a message for the chef.'
            }
        });
    }

    try {
        const questionData = insertPendingQuestionSchema.parse({
            restaurantId,
            customerSessionId: sessionId || `vapi-${Date.now()}`,
            question: message,
            language: 'en',
            status: 'pending',
            tableNumber: tableNumber || null,
        });

        const question = await storage.createPendingQuestion(questionData);

        // Notify via WebSocket
        if (wsManager) {
            wsManager.notifyNewPendingQuestion(restaurantId, question);
        }
        if (apiGatewayWebSocketManager) {
            await apiGatewayWebSocketManager.notifyNewPendingQuestion(restaurantId, question);
        }

        console.log('[VAPI] Created pending question:', question.id);

        return res.json({
            result: {
                success: true,
                action: 'chef_called',
                questionId: question.id,
                message: "I've sent your message to the chef. They will be notified immediately. Is there anything else I can help you with while we wait?"
            }
        });
    } catch (error) {
        console.error('[VAPI] Error calling chef:', error);
        return res.json({
            result: {
                success: false,
                message: 'Sorry, I could not reach the chef. Please ask a staff member directly.'
            }
        });
    }
}

/**
 * Handle call_waiter function - creates an assistance request
 */
async function handleCallWaiter(
    res: Response,
    parameters: any,
    context: { restaurantId?: string; tableId?: string },
    storage: IStorage
) {
    const { restaurantId, tableId } = context;
    const { message } = parameters;

    if (!restaurantId) {
        return res.json({
            result: {
                success: false,
                message: 'Restaurant context not found.'
            }
        });
    }

    try {
        const request = await storage.createAssistanceRequest({
            restaurantId,
            tableId: tableId || null,
            orderId: null,
            customerMessage: message || 'Customer requested assistance',
            requestType: 'call_waiter',
            status: 'pending',
        });

        // Notify via WebSocket
        if (wsManager) {
            wsManager.notifyNewAssistanceRequest(restaurantId, request);
        }
        if (apiGatewayWebSocketManager) {
            await apiGatewayWebSocketManager.notifyNewAssistanceRequest(restaurantId, request);
        }

        console.log('[VAPI] Created assistance request:', request.id);

        return res.json({
            result: {
                success: true,
                action: 'waiter_called',
                requestId: request.id,
                message: "I've called a waiter and passed on your message. They will be with you shortly. Is there anything else I can help with in the meantime?"
            }
        });
    } catch (error) {
        console.error('[VAPI] Error calling waiter:', error);
        return res.json({
            result: {
                success: false,
                message: 'Sorry, I could not reach a waiter. Please wave to get the attention of nearby staff.'
            }
        });
    }
}

/**
 * Handle open_checkout function - signals frontend to open checkout UI
 */
function handleOpenCheckout(res: Response, parameters: any) {
    const { tip_amount, customer_note } = parameters;

    return res.json({
        result: {
            success: true,
            action: 'open_checkout',
            tipAmount: tip_amount,
            customerNote: customer_note,
            message: "I've opened the checkout page for you. Please enter your payment details to complete your order."
        }
    });
}
