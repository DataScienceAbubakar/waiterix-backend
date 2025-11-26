// Unified Payment Gateway Interface
// Exports all payment gateway implementations and provides a factory function

import { Paystack } from './paystack';
import { Telr } from './telr';
import { Adyen } from './adyen';
import { PaymentGateway } from '../paymentGateway';

export { Paystack, Telr, Adyen };

/**
 * Get the payment provider implementation for a gateway
 */
export function getPaymentProvider(gateway: PaymentGateway) {
  switch (gateway) {
    case 'paystack':
      return Paystack;
    case 'telr':
      return Telr;
    case 'adyen':
      return Adyen;
    case 'stripe':
      // Stripe is handled separately through the existing Stripe SDK integration
      return null;
    default:
      return null;
  }
}

/**
 * Check if any payment gateway is configured and ready
 */
export function hasConfiguredGateway(): boolean {
  return (
    Paystack.isConfigured() ||
    Telr.isConfigured() ||
    Adyen.isConfigured() ||
    !!(process.env.STRIPE_SECRET_KEY)
  );
}

/**
 * Get list of all configured payment gateways with their status
 */
export function getGatewayStatus() {
  return {
    stripe: {
      configured: !!(process.env.STRIPE_SECRET_KEY),
      name: 'Stripe',
      region: 'US/Europe/Global',
    },
    paystack: {
      configured: Paystack.isConfigured(),
      name: 'Paystack',
      region: 'Nigeria/West Africa',
    },
    telr: {
      configured: Telr.isConfigured(),
      name: 'Telr',
      region: 'Middle East',
    },
    adyen: {
      configured: Adyen.isConfigured(),
      name: 'Adyen',
      region: 'Asia',
    },
  };
}
