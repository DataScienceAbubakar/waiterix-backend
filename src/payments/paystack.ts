// Paystack Payment Gateway Integration (Nigeria/West Africa)
// This module provides placeholder implementations until Paystack API keys are configured

import crypto from "crypto";

interface PaystackConfig {
  secretKey: string | undefined;
  publicKey: string | undefined;
}

function getConfig(): PaystackConfig {
  return {
    secretKey: process.env.PAYSTACK_SECRET_KEY,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY,
  };
}

export function isConfigured(): boolean {
  const config = getConfig();
  return !!(config.secretKey && config.publicKey);
}

/**
 * Create a Paystack subaccount for a restaurant
 * @param restaurantName - Name of the restaurant
 * @param bankCode - Nigerian bank code (e.g., '044' for Access Bank)
 * @param accountNumber - Restaurant's bank account number
 * @param percentageCharge - Percentage of transaction the platform takes (0-100)
 * @returns Subaccount code or placeholder
 */
export async function createSubaccount(
  restaurantName: string,
  bankCode: string,
  accountNumber: string,
  percentageCharge: number = 0
): Promise<{ subaccountCode: string; accountName: string; isPlaceholder: boolean }> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Paystack] API keys not configured - returning placeholder subaccount');
    return {
      subaccountCode: `PLACEHOLDER_${Date.now()}`,
      accountName: 'Placeholder Account',
      isPlaceholder: true,
    };
  }

  try {
    const response = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: restaurantName,
        settlement_bank: bankCode,
        account_number: accountNumber,
        percentage_charge: percentageCharge,
        description: `Subaccount for ${restaurantName}`,
      }),
    });

    const data = await response.json();
    
    if (!response.ok || !data.status) {
      console.error('[Paystack] Subaccount creation failed:', data.message);
      throw new Error(data.message || 'Failed to create Paystack subaccount');
    }

    console.log('[Paystack] Subaccount created successfully:', data.data.subaccount_code);
    return {
      subaccountCode: data.data.subaccount_code,
      accountName: data.data.account_name,
      isPlaceholder: false,
    };
  } catch (error) {
    console.error('[Paystack] Error creating subaccount:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to create Paystack subaccount');
  }
}

/**
 * Initialize a payment transaction
 * @param amount - Amount in kobo (100 kobo = 1 NGN)
 * @param email - Customer email
 * @param subaccountCode - Restaurant's subaccount code (optional for direct charges)
 * @param metadata - Additional transaction data
 * @returns Authorization URL and reference
 */
export async function initializeTransaction(
  amount: number,
  email: string,
  callbackUrl: string,
  subaccountCode?: string,
  metadata?: Record<string, any>
): Promise<{ authorizationUrl: string; reference: string; accessCode: string; isPlaceholder: boolean }> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Paystack] API keys not configured - payment will fail gracefully');
    return {
      authorizationUrl: '/payment-unavailable',
      reference: `PLACEHOLDER_${Date.now()}`,
      accessCode: '',
      isPlaceholder: true,
    };
  }

  try {
    const body: any = {
      amount: Math.round(amount), // Ensure amount is an integer (kobo)
      email,
      callback_url: callbackUrl, // Redirect URL after payment
      metadata,
    };

    // Only add subaccount if provided (for split payments)
    if (subaccountCode) {
      body.subaccount = subaccountCode;
      body.bearer = 'subaccount'; // Subaccount bears transaction fees
    }

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    
    if (!response.ok || !data.status) {
      console.error('[Paystack] Transaction initialization failed:', data.message);
      throw new Error(data.message || 'Failed to initialize Paystack transaction');
    }

    console.log('[Paystack] Transaction initialized successfully:', data.data.reference);
    return {
      authorizationUrl: data.data.authorization_url,
      reference: data.data.reference,
      accessCode: data.data.access_code,
      isPlaceholder: false,
    };
  } catch (error) {
    console.error('[Paystack] Error initializing transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to initialize Paystack transaction');
  }
}

/**
 * Verify a payment transaction
 * @param reference - Transaction reference
 * @returns Transaction status and details
 */
export async function verifyTransaction(
  reference: string
): Promise<{ 
  status: 'success' | 'failed' | 'pending'; 
  amount: number;
  paidAt?: Date;
  channel?: string;
  currency?: string;
}> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Paystack] API keys not configured - cannot verify transaction');
    return { status: 'pending', amount: 0 };
  }

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
      },
    });

    const data = await response.json();
    
    if (!response.ok || !data.status) {
      console.error('[Paystack] Transaction verification failed:', data.message);
      throw new Error(data.message || 'Failed to verify Paystack transaction');
    }

    console.log('[Paystack] Transaction verified:', reference, 'Status:', data.data.status);
    return {
      status: data.data.status,
      amount: data.data.amount,
      paidAt: data.data.paid_at ? new Date(data.data.paid_at) : undefined,
      channel: data.data.channel,
      currency: data.data.currency,
    };
  } catch (error) {
    console.error('[Paystack] Error verifying transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to verify Paystack transaction');
  }
}

/**
 * Get list of Nigerian banks supported by Paystack
 * @returns Array of banks with name, code, and other details
 */
export async function getBanks(): Promise<Array<{ name: string; code: string; id: number }>> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Paystack] API keys not configured - returning empty bank list');
    return [];
  }

  try {
    const response = await fetch('https://api.paystack.co/bank', {
      headers: {
        'Authorization': `Bearer ${config.secretKey}`,
      },
    });

    const data = await response.json();
    
    if (!response.ok || !data.status) {
      console.error('[Paystack] Failed to fetch banks:', data.message);
      throw new Error(data.message || 'Failed to fetch Paystack banks');
    }

    return data.data.map((bank: any) => ({
      name: bank.name,
      code: bank.code,
      id: bank.id,
    }));
  } catch (error) {
    console.error('[Paystack] Error fetching banks:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to fetch Paystack banks');
  }
}

/**
 * Verify webhook signature from Paystack
 * @param payload - Raw request body as string
 * @param signature - x-paystack-signature header value
 * @returns true if signature is valid
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const config = getConfig();
  
  if (!config.secretKey) {
    console.warn('[Paystack Webhook] Cannot verify signature - secret key not configured');
    return false;
  }

  try {
    const hash = crypto
      .createHmac('sha512', config.secretKey)
      .update(payload)
      .digest('hex');
    
    return hash === signature;
  } catch (error) {
    console.error('[Paystack Webhook] Error verifying signature:', error);
    return false;
  }
}

/**
 * Parse and validate Paystack webhook event
 * @param event - Webhook event data
 * @returns Parsed event with type-safe data
 */
export interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    status: 'success' | 'failed' | 'abandoned';
    amount: number;
    currency: string;
    paid_at?: string;
    channel?: string;
    metadata?: Record<string, any>;
  };
}

export function parseWebhookEvent(event: any): PaystackWebhookEvent | null {
  try {
    // Validate required fields
    if (!event.event || !event.data || !event.data.reference) {
      console.error('[Paystack Webhook] Invalid event structure:', event);
      return null;
    }

    return event as PaystackWebhookEvent;
  } catch (error) {
    console.error('[Paystack Webhook] Error parsing event:', error);
    return null;
  }
}

export const Paystack = {
  isConfigured,
  createSubaccount,
  initializeTransaction,
  verifyTransaction,
  getBanks,
  verifyWebhookSignature,
  parseWebhookEvent,
};
