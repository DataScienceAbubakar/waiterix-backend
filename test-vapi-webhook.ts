/**
 * Quick test script for VAPI webhook
 * Run with: npx tsx test-vapi-webhook.ts
 */

import express from 'express';

// Mock storage interface for testing
const mockStorage = {
    getRestaurant: async (id: string) => ({
        id,
        name: 'Test Restaurant',
        state: 'CA',
        subscriptionStatus: 'active',
    }),
    getRestaurantTable: async (id: string) => ({
        id,
        restaurantId: 'test-restaurant',
        tableNumber: '1',
    }),
    getTableByNumber: async (restaurantId: string, tableNumber: string) => ({
        id: 'table-uuid',
        restaurantId,
        tableNumber,
    }),
    createOrder: async (orderData: any, items: any[]) => ({
        id: 'test-order-' + Date.now(),
        ...orderData,
        items,
        createdAt: new Date().toISOString(),
    }),
    createPendingQuestion: async (data: any) => ({
        id: 'question-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
    }),
    createAssistanceRequest: async (data: any) => ({
        id: 'request-' + Date.now(),
        ...data,
        createdAt: new Date().toISOString(),
    }),
    getMenuItems: async () => [],
};

// Import the webhook handler - simplified version for testing
const app = express();
app.use(express.json());

// VAPI Webhook endpoint
app.post('/api/vapi/webhook', async (req, res) => {
    try {
        const { type, functionCall, call } = req.body;
        console.log('[VAPI Test] Received:', type, functionCall?.name);

        if (type === 'function-call' && functionCall) {
            const { name, parameters } = functionCall;

            switch (name) {
                case 'add_to_cart':
                    return res.json({
                        result: {
                            success: true,
                            action: 'add_to_cart',
                            items: parameters.items,
                            message: `Items processed for cart`,
                        },
                    });

                case 'remove_from_cart':
                    return res.json({
                        result: {
                            success: true,
                            action: 'remove_from_cart',
                            items: parameters.items,
                            message: `Items removed from cart`,
                        },
                    });

                case 'confirm_order':
                    // Mock order creation
                    const order = await mockStorage.createOrder(
                        { restaurantId: 'test', subtotal: '10.00', tax: '0.80', total: '10.80' },
                        parameters.cart_items || []
                    );
                    return res.json({
                        result: {
                            success: true,
                            action: 'order_confirmed',
                            orderId: order.id,
                            message: 'Order placed successfully!',
                        },
                    });

                case 'call_chef':
                    const question = await mockStorage.createPendingQuestion({
                        restaurantId: 'test',
                        question: parameters.message,
                        status: 'pending',
                    });
                    return res.json({
                        result: {
                            success: true,
                            action: 'chef_called',
                            questionId: question.id,
                            message: "Message sent to chef.",
                        },
                    });

                case 'call_waiter':
                    const request = await mockStorage.createAssistanceRequest({
                        restaurantId: 'test',
                        customerMessage: parameters.message,
                        status: 'pending',
                    });
                    return res.json({
                        result: {
                            success: true,
                            action: 'waiter_called',
                            requestId: request.id,
                            message: "A waiter has been notified.",
                        },
                    });

                case 'open_checkout':
                    return res.json({
                        result: {
                            success: true,
                            action: 'open_checkout',
                            tipAmount: parameters.tip_amount,
                            customerNote: parameters.customer_note,
                            message: "Checkout page opened.",
                        },
                    });

                default:
                    return res.json({
                        result: { success: false, message: `Unknown function: ${name}` },
                    });
            }
        }

        res.json({ status: 'ok' });
    } catch (error: any) {
        console.error('[VAPI Test] Error:', error);
        res.status(500).json({ result: { success: false, message: error.message } });
    }
});

// Start server
const PORT = 3006;
app.listen(PORT, () => {
    console.log(`\n🧪 VAPI Webhook Test Server running on port ${PORT}`);
    console.log(`\nTest commands (run in another terminal):\n`);
    console.log(`1. Add to cart:`);
    console.log(`   Invoke-RestMethod -Uri "http://localhost:${PORT}/api/vapi/webhook" -Method POST -ContentType "application/json" -Body '{"type":"function-call","functionCall":{"name":"add_to_cart","parameters":{"items":[{"item_name":"Burger","quantity":2}]}}}'`);
    console.log(`\n2. Confirm order:`);
    console.log(`   Invoke-RestMethod -Uri "http://localhost:${PORT}/api/vapi/webhook" -Method POST -ContentType "application/json" -Body '{"type":"function-call","functionCall":{"name":"confirm_order","parameters":{"payment_method":"cash","cart_items":[{"id":"1","name":"Burger","price":"9.99","quantity":1}]}}}'`);
    console.log(`\n3. Call chef:`);
    console.log(`   Invoke-RestMethod -Uri "http://localhost:${PORT}/api/vapi/webhook" -Method POST -ContentType "application/json" -Body '{"type":"function-call","functionCall":{"name":"call_chef","parameters":{"message":"Is the soup gluten-free?"}}}'`);
    console.log(`\n4. Call waiter:`);
    console.log(`   Invoke-RestMethod -Uri "http://localhost:${PORT}/api/vapi/webhook" -Method POST -ContentType "application/json" -Body '{"type":"function-call","functionCall":{"name":"call_waiter","parameters":{"message":"Need help with the menu"}}}'`);
    console.log(`\n5. Open checkout:`);
    console.log(`   Invoke-RestMethod -Uri "http://localhost:${PORT}/api/vapi/webhook" -Method POST -ContentType "application/json" -Body '{"type":"function-call","functionCall":{"name":"open_checkout","parameters":{"tip_amount":5}}}'`);
    console.log(`\nPress Ctrl+C to stop.\n`);
});
