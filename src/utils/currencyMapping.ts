/**
 * Comprehensive country-to-currency mapping
 * Maps ISO country codes to their respective currency codes
 */
export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // Africa
  'Nigeria': 'NGN',
  'South Africa': 'ZAR',
  'Kenya': 'KES',
  'Ghana': 'GHS',
  'Egypt': 'EGP',
  'Morocco': 'MAD',
  'Tanzania': 'TZS',
  'Uganda': 'UGX',
  'Ethiopia': 'ETB',
  'Ivory Coast': 'XOF',
  
  // North America
  'United States': 'USD',
  'Canada': 'CAD',
  'Mexico': 'MXN',
  
  // South America
  'Brazil': 'BRL',
  'Argentina': 'ARS',
  'Chile': 'CLP',
  'Colombia': 'COP',
  'Peru': 'PEN',
  'Venezuela': 'VES',
  
  // Europe
  'United Kingdom': 'GBP',
  'Germany': 'EUR',
  'France': 'EUR',
  'Italy': 'EUR',
  'Spain': 'EUR',
  'Netherlands': 'EUR',
  'Belgium': 'EUR',
  'Austria': 'EUR',
  'Portugal': 'EUR',
  'Greece': 'EUR',
  'Ireland': 'EUR',
  'Finland': 'EUR',
  'Poland': 'PLN',
  'Sweden': 'SEK',
  'Norway': 'NOK',
  'Denmark': 'DKK',
  'Switzerland': 'CHF',
  'Czech Republic': 'CZK',
  'Hungary': 'HUF',
  'Romania': 'RON',
  'Russia': 'RUB',
  'Ukraine': 'UAH',
  'Turkey': 'TRY',
  
  // Middle East
  'United Arab Emirates': 'AED',
  'Saudi Arabia': 'SAR',
  'Qatar': 'QAR',
  'Kuwait': 'KWD',
  'Bahrain': 'BHD',
  'Oman': 'OMR',
  'Jordan': 'JOD',
  'Lebanon': 'LBP',
  'Israel': 'ILS',
  
  // Asia
  'China': 'CNY',
  'Japan': 'JPY',
  'India': 'INR',
  'South Korea': 'KRW',
  'Singapore': 'SGD',
  'Hong Kong': 'HKD',
  'Taiwan': 'TWD',
  'Thailand': 'THB',
  'Malaysia': 'MYR',
  'Indonesia': 'IDR',
  'Philippines': 'PHP',
  'Vietnam': 'VND',
  'Pakistan': 'PKR',
  'Bangladesh': 'BDT',
  'Sri Lanka': 'LKR',
  
  // Oceania
  'Australia': 'AUD',
  'New Zealand': 'NZD',
};

/**
 * Get currency code for a given country
 * @param country - Country name
 * @returns Currency code (e.g., 'NGN', 'USD') or 'USD' as fallback
 */
export function getCurrencyForCountry(country: string | null | undefined): string {
  if (!country) {
    return 'USD';
  }
  
  return COUNTRY_TO_CURRENCY[country] || 'USD';
}

/**
 * Currency symbol mapping for display purposes
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  'USD': '$',
  'EUR': '€',
  'GBP': '£',
  'JPY': '¥',
  'CNY': '¥',
  'NGN': '₦',
  'ZAR': 'R',
  'INR': '₹',
  'AUD': 'A$',
  'CAD': 'C$',
  'CHF': 'Fr',
  'BRL': 'R$',
  'AED': 'د.إ',
  'SAR': 'ر.س',
};

/**
 * Locale mapping for currency formatting
 * Maps currency codes to appropriate locales for number formatting
 */
export const CURRENCY_LOCALES: Record<string, string> = {
  'USD': 'en-US',
  'EUR': 'de-DE',
  'GBP': 'en-GB',
  'JPY': 'ja-JP',
  'CNY': 'zh-CN',
  'NGN': 'en-NG',
  'ZAR': 'en-ZA',
  'INR': 'en-IN',
  'AUD': 'en-AU',
  'CAD': 'en-CA',
  'MXN': 'es-MX',
  'BRL': 'pt-BR',
  'ARS': 'es-AR',
  'AED': 'ar-AE',
  'SAR': 'ar-SA',
  'KRW': 'ko-KR',
  'SGD': 'en-SG',
  'HKD': 'zh-HK',
  'THB': 'th-TH',
  'MYR': 'ms-MY',
  'IDR': 'id-ID',
  'PHP': 'en-PH',
  'VND': 'vi-VN',
};