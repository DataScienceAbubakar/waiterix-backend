// Adyen Payment Gateway Integration (Asia: China, Japan, Singapore, etc.)
// This module provides placeholder implementations until Adyen API keys are configured

interface AdyenConfig {
  apiKey: string | undefined;
  merchantAccount: string | undefined;
  environment: string;
}

function getConfig(): AdyenConfig {
  return {
    apiKey: process.env.ADYEN_API_KEY,
    merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
    environment: process.env.ADYEN_ENVIRONMENT || 'test',
  };
}

export function isConfigured(): boolean {
  const config = getConfig();
  return !!(config.apiKey && config.merchantAccount);
}

/**
 * Create an Adyen account holder (sub-merchant) for a restaurant
 * @param restaurantName - Name of the restaurant
 * @param businessEmail - Business email
 * @param country - Restaurant country (2-letter ISO code)
 * @returns Account holder code or placeholder
 */
export async function createAccountHolder(
  restaurantName: string,
  businessEmail: string,
  country: string
): Promise<{ accountHolderCode: string; isPlaceholder: boolean }> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Adyen] API keys not configured - returning placeholder account holder');
    return {
      accountHolderCode: `PLACEHOLDER_${Date.now()}`,
      isPlaceholder: true,
    };
  }

  try {
    // TODO: Implement real Adyen Marketpay account holder creation when API keys are added
    // For multi-restaurant platforms, Adyen offers "Marketpay" (now called "Balance Platform")
    // which allows creating sub-merchants with split payments
    
    // const response = await fetch(`https://${config.environment}-pal-test.adyenpayments.com/pal/servlet/Account/v6/createAccountHolder`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-API-Key': config.apiKey,
    //   },
    //   body: JSON.stringify({
    //     accountHolderCode: `RESTAURANT_${Date.now()}`,
    //     accountHolderDetails: {
    //       email: businessEmail,
    //       fullPhoneNumber: '+1234567890', // Get from restaurant
    //       businessDetails: {
    //         legalBusinessName: restaurantName,
    //         registrationNumber: '...', // Business registration
    //       },
    //       address: {
    //         country,
    //         // Other address fields
    //       },
    //     },
    //     legalEntity: 'Business',
    //     processingTier: 1,
    //   }),
    // });
    // const data = await response.json();
    // return {
    //   accountHolderCode: data.accountHolderCode,
    //   isPlaceholder: false,
    // };

    console.log('[Adyen] Real API implementation pending - using placeholder');
    return {
      accountHolderCode: `PENDING_SETUP_${Date.now()}`,
      isPlaceholder: true,
    };
  } catch (error) {
    console.error('[Adyen] Error creating account holder:', error);
    throw new Error('Failed to create Adyen account holder');
  }
}

/**
 * Create a payment session
 * @param amount - Amount in minor units (e.g., cents)
 * @param currency - Currency code (USD, EUR, etc.)
 * @param merchantAccount - Restaurant's merchant account
 * @param returnUrl - URL to return after payment
 * @returns Session ID and payment URL
 */
export async function createPaymentSession(
  amount: number,
  currency: string,
  merchantAccount: string,
  returnUrl: string
): Promise<{ sessionId: string; sessionData: string; isPlaceholder: boolean }> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Adyen] API keys not configured - payment will fail gracefully');
    return {
      sessionId: `PLACEHOLDER_${Date.now()}`,
      sessionData: '',
      isPlaceholder: true,
    };
  }

  try {
    // TODO: Implement real Adyen payment session when API keys are added
    // const response = await fetch(`https://${config.environment}-checkout-live.adyenpayments.com/checkout/v69/sessions`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-API-Key': config.apiKey,
    //   },
    //   body: JSON.stringify({
    //     merchantAccount: config.merchantAccount,
    //     amount: {
    //       value: amount,
    //       currency,
    //     },
    //     reference: `ORDER_${Date.now()}`,
    //     returnUrl,
    //     countryCode: 'SG', // Or detect from restaurant
    //     shopperLocale: 'en-US',
    //     splits: [
    //       {
    //         account: merchantAccount, // Restaurant's account
    //         amount: {
    //           value: amount,
    //           currency,
    //         },
    //         type: 'MarketPlace',
    //         reference: `SPLIT_${Date.now()}`,
    //       },
    //     ],
    //   }),
    // });
    // const data = await response.json();
    // return {
    //   sessionId: data.id,
    //   sessionData: data.sessionData,
    //   isPlaceholder: false,
    // };

    console.log('[Adyen] Real API implementation pending');
    return {
      sessionId: `PENDING_${Date.now()}`,
      sessionData: '',
      isPlaceholder: true,
    };
  } catch (error) {
    console.error('[Adyen] Error creating payment session:', error);
    throw new Error('Failed to create Adyen payment session');
  }
}

/**
 * Get payment details
 * @param pspReference - Payment reference
 * @returns Payment status
 */
export async function getPaymentDetails(
  pspReference: string
): Promise<{ status: 'success' | 'failed' | 'pending'; amount: number }> {
  const config = getConfig();
  
  if (!isConfigured()) {
    console.log('[Adyen] API keys not configured - cannot verify payment');
    return { status: 'pending', amount: 0 };
  }

  try {
    // TODO: Implement real Adyen payment verification when API keys are added
    // const response = await fetch(`https://${config.environment}-checkout-live.adyenpayments.com/checkout/v69/payments/${pspReference}`, {
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'X-API-Key': config.apiKey,
    //   },
    // });
    // const data = await response.json();
    // const statusMap: Record<string, 'success' | 'failed' | 'pending'> = {
    //   'Authorised': 'success',
    //   'Received': 'pending',
    //   'Pending': 'pending',
    //   'Refused': 'failed',
    //   'Cancelled': 'failed',
    //   'Error': 'failed',
    // };
    // return {
    //   status: statusMap[data.status] || 'pending',
    //   amount: data.amount?.value || 0,
    // };

    console.log('[Adyen] Real API implementation pending');
    return { status: 'pending', amount: 0 };
  } catch (error) {
    console.error('[Adyen] Error getting payment details:', error);
    throw new Error('Failed to get Adyen payment details');
  }
}

export const Adyen = {
  isConfigured,
  createAccountHolder,
  createPaymentSession,
  getPaymentDetails,
};
