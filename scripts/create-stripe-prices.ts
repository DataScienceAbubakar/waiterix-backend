import Stripe from 'stripe';

// This script creates the necessary Stripe prices for Waiterix
// Run with: npx tsx scripts/create-stripe-prices.ts

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

async function createPrices() {
  try {
    console.log('Creating Stripe prices for Waiterix...\n');

    // 1. Create base subscription product
    const baseProduct = await stripe.products.create({
      name: 'Waiterix Base Subscription',
      description: 'Monthly base subscription for restaurant management platform',
    });
    console.log('✅ Base product created:', baseProduct.id);

    // Create base subscription price ($50/month)
    const basePrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 5000, // $50.00
      recurring: {
        interval: 'month',
      },
      product: baseProduct.id,
    });
    console.log('✅ Base subscription price created:');
    console.log(`   Price ID: ${basePrice.id}`);
    console.log(`   Amount: $${(basePrice.unit_amount! / 100).toFixed(2)}/month\n`);

    // 2. Create AI usage product
    const usageProduct = await stripe.products.create({
      name: 'Waiterix AI Usage',
      description: 'Metered AI usage charges (per request)',
    });
    console.log('✅ AI usage product created:', usageProduct.id);

    // Create metered AI usage price (per request)
    const usagePrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: 10, // $0.10 per AI request
      recurring: {
        interval: 'month',
        usage_type: 'metered',
      },
      product: usageProduct.id,
    });
    console.log('✅ AI usage price created:');
    console.log(`   Price ID: ${usagePrice.id}`);
    console.log(`   Amount: $${(usagePrice.unit_amount! / 100).toFixed(2)} per request\n`);

    console.log('════════════════════════════════════════════════════');
    console.log('Add these to your Environment Variables:');
    console.log('════════════════════════════════════════════════════');
    console.log(`STRIPE_BASE_PRICE_ID=${basePrice.id}`);
    console.log(`STRIPE_USAGE_PRICE_ID=${usagePrice.id}`);
    console.log('════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('Error creating prices:', error);
    process.exit(1);
  }
}

createPrices();