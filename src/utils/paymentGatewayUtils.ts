// Shared Payment Gateway Selection Logic
// Used by both frontend and backend to ensure consistent gateway routing

export type PaymentGateway = 'stripe' | 'paystack' | 'telr' | 'adyen';

// Country-to-Gateway Mappings
const PAYSTACK_COUNTRIES = [
  'Nigeria',
  'Ghana',
  'Kenya',
  'South Africa',
];

const TELR_COUNTRIES = [
  'United Arab Emirates',
  'UAE',
  'Saudi Arabia',
  'Kuwait',
  'Qatar',
  'Bahrain',
  'Oman',
  'Jordan',
  'Lebanon',
  'Egypt',
];

const ADYEN_COUNTRIES = [
  'China',
  'Japan',
  'South Korea',
  'Singapore',
  'Malaysia',
  'Thailand',
  'Indonesia',
  'Philippines',
  'Vietnam',
  'India',
  'Pakistan',
  'Bangladesh',
  'Taiwan',
  'Hong Kong',
];

/**
 * Determines which payment gateway to use based on restaurant's country
 * This is the single source of truth for gateway selection
 */
export function getPaymentGateway(country: string | null | undefined): PaymentGateway {
  if (!country) {
    return 'stripe';
  }

  const normalizedCountry = country.trim();

  if (PAYSTACK_COUNTRIES.some(c => normalizedCountry.toLowerCase().includes(c.toLowerCase()))) {
    return 'paystack';
  }

  if (TELR_COUNTRIES.some(c => normalizedCountry.toLowerCase().includes(c.toLowerCase()))) {
    return 'telr';
  }

  if (ADYEN_COUNTRIES.some(c => normalizedCountry.toLowerCase().includes(c.toLowerCase()))) {
    return 'adyen';
  }

  return 'stripe';
}

/**
 * Gets the display name for a payment gateway
 */
export function getGatewayDisplayName(gateway: PaymentGateway): string {
  switch (gateway) {
    case 'stripe':
      return 'Stripe';
    case 'paystack':
      return 'Paystack';
    case 'telr':
      return 'Telr';
    case 'adyen':
      return 'Adyen';
    default:
      return 'Stripe';
  }
}

/**
 * Gets the region description for a payment gateway
 */
export function getGatewayRegion(gateway: PaymentGateway): string {
  switch (gateway) {
    case 'stripe':
      return 'US/Europe/Global';
    case 'paystack':
      return 'Nigeria/West Africa';
    case 'telr':
      return 'Middle East';
    case 'adyen':
      return 'Asia';
    default:
      return 'Global';
  }
}

/**
 * Gets gateway info including name and region
 */
export function getGatewayInfo(country: string | null | undefined): {
  gateway: PaymentGateway;
  name: string;
  region: string;
} {
  const gateway = getPaymentGateway(country);
  return {
    gateway,
    name: getGatewayDisplayName(gateway),
    region: getGatewayRegion(gateway),
  };
}