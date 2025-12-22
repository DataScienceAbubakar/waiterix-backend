/**
 * US State Sales Tax Rates
 * Updated as of 2024
 * Note: These are state-level rates only. Local rates may apply additionally.
 * Source: Tax Foundation & state revenue departments
 */

export const US_STATE_SALES_TAX_RATES: Record<string, number> = {
    // States with no sales tax
    'AK': 0.00,  // Alaska (local taxes may apply)
    'DE': 0.00,  // Delaware
    'MT': 0.00,  // Montana
    'NH': 0.00,  // New Hampshire
    'OR': 0.00,  // Oregon

    // States with sales tax (alphabetical)
    'AL': 0.04,  // Alabama - 4%
    'AR': 0.065, // Arkansas - 6.5%
    'AZ': 0.056, // Arizona - 5.6%
    'CA': 0.0725,// California - 7.25%
    'CO': 0.029, // Colorado - 2.9%
    'CT': 0.0635,// Connecticut - 6.35%
    'DC': 0.06,  // District of Columbia - 6%
    'FL': 0.06,  // Florida - 6%
    'GA': 0.04,  // Georgia - 4%
    'HI': 0.04,  // Hawaii - 4%
    'IA': 0.06,  // Iowa - 6%
    'ID': 0.06,  // Idaho - 6%
    'IL': 0.0625,// Illinois - 6.25%
    'IN': 0.07,  // Indiana - 7%
    'KS': 0.065, // Kansas - 6.5%
    'KY': 0.06,  // Kentucky - 6%
    'LA': 0.0445,// Louisiana - 4.45%
    'MA': 0.0625,// Massachusetts - 6.25%
    'MD': 0.06,  // Maryland - 6%
    'ME': 0.055, // Maine - 5.5%
    'MI': 0.06,  // Michigan - 6%
    'MN': 0.06875,// Minnesota - 6.875%
    'MO': 0.04225,// Missouri - 4.225%
    'MS': 0.07,  // Mississippi - 7%
    'NC': 0.0475,// North Carolina - 4.75%
    'ND': 0.05,  // North Dakota - 5%
    'NE': 0.055, // Nebraska - 5.5%
    'NJ': 0.06625,// New Jersey - 6.625%
    'NM': 0.05125,// New Mexico - 5.125%
    'NV': 0.0685,// Nevada - 6.85%
    'NY': 0.04,  // New York - 4% (local taxes make it higher)
    'OH': 0.0575,// Ohio - 5.75%
    'OK': 0.045, // Oklahoma - 4.5%
    'PA': 0.06,  // Pennsylvania - 6%
    'RI': 0.07,  // Rhode Island - 7%
    'SC': 0.06,  // South Carolina - 6%
    'SD': 0.045, // South Dakota - 4.5%
    'TN': 0.07,  // Tennessee - 7%
    'TX': 0.0625,// Texas - 6.25%
    'UT': 0.0485,// Utah - 4.85%
    'VA': 0.053, // Virginia - 5.3%
    'VT': 0.06,  // Vermont - 6%
    'WA': 0.065, // Washington - 6.5%
    'WI': 0.05,  // Wisconsin - 5%
    'WV': 0.06,  // West Virginia - 6%
    'WY': 0.04,  // Wyoming - 4%
};

/**
 * Get sales tax rate for a given US state
 * @param stateCode - Two-letter state code (e.g., 'CA', 'NY')
 * @returns Tax rate as a decimal (e.g., 0.0725 for 7.25%)
 */
export function getSalesTaxRate(stateCode: string | null | undefined): number {
    if (!stateCode) {
        // Default to 8% if no state is provided
        return 0.08;
    }

    const upperStateCode = stateCode.toUpperCase().trim();
    const rate = US_STATE_SALES_TAX_RATES[upperStateCode];

    if (rate === undefined) {
        console.warn(`Unknown state code: ${stateCode}. Using default 8% tax rate.`);
        return 0.08; // Default fallback
    }

    return rate;
}

/**
 * Calculate sales tax for a given subtotal and state
 * @param subtotal - The subtotal amount
 * @param stateCode - Two-letter state code
 * @returns Tax amount
 */
export function calculateSalesTax(subtotal: number, stateCode: string | null | undefined): number {
    const taxRate = getSalesTaxRate(stateCode);
    return subtotal * taxRate;
}

/**
 * Get formatted tax rate as percentage string
 * @param stateCode - Two-letter state code
 * @returns Formatted percentage (e.g., "7.25%")
 */
export function getFormattedTaxRate(stateCode: string | null | undefined): string {
    const rate = getSalesTaxRate(stateCode);
    return `${(rate * 100).toFixed(2)}%`;
}
