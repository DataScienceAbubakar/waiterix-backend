// Payment Gateway Selection Utility
// Re-exports shared gateway selection logic

import {
  PaymentGateway,
  getPaymentGateway,
  getGatewayDisplayName,
  getGatewayRegion,
  getGatewayInfo,
} from '@/shared/paymentGatewayUtils';

export type { PaymentGateway };
export { getPaymentGateway, getGatewayDisplayName, getGatewayRegion, getGatewayInfo };

/**
 * Checks if a gateway is configured (API keys are present)
 */
export function isGatewayConfigured(gateway: PaymentGateway): boolean {
  switch (gateway) {
    case 'stripe':
      return !!(process.env.STRIPE_SECRET_KEY);
    case 'paystack':
      return !!(process.env.PAYSTACK_SECRET_KEY);
    case 'telr':
      return !!(process.env.TELR_API_KEY && process.env.TELR_MERCHANT_ID);
    case 'adyen':
      return !!(process.env.ADYEN_API_KEY && process.env.ADYEN_MERCHANT_ACCOUNT);
    default:
      return false;
  }
}

/**
 * Gets a list of all configured gateways
 */
export function getConfiguredGateways(): PaymentGateway[] {
  const gateways: PaymentGateway[] = ['stripe', 'paystack', 'telr', 'adyen'];
  return gateways.filter(gateway => isGatewayConfigured(gateway));
}

/**
 * Gets the onboarding status field name for a gateway
 */
export function getOnboardingField(gateway: PaymentGateway): string {
  switch (gateway) {
    case 'stripe':
      return 'stripeOnboardingComplete';
    case 'paystack':
      return 'paystackOnboardingComplete';
    case 'telr':
      return 'telrOnboardingComplete';
    case 'adyen':
      return 'adyenOnboardingComplete';
  }
}
