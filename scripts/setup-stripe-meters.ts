import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is not set');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-12-18.acacia',
});

async function setupStripeMeters() {
  try {
    console.log('Setting up Stripe Meters for Waiterix...\n');

    // Step 1: Create a Billing Meter for AI usage
    console.log('Step 1: Creating Billing Meter for AI usage...');
    const meter = await stripe.billing.meters.create({
      display_name: 'AI Waiter Requests',
      event_name: 'ai_waiter_request',
      default_aggregation: {
        formula: 'sum',
      },
    });
    console.log('✓ Meter created:', meter.id);
    console.log('  Event name:', meter.event_name);
    console.log('  Aggregation:', meter.default_aggregation.formula, '\n');

    // Step 2: Create product if needed
    console.log('Step 2: Creating/verifying Waiterix product...');
    const product = await stripe.products.create({
      name: 'Waiterix Restaurant Platform',
      description: 'AI-powered restaurant ordering platform with QR code menus and multi-language support',
    });
    console.log('✓ Product created:', product.id, '\n');

    // Step 3: Create base subscription price ($50/month)
    console.log('Step 3: Creating base subscription price ($50/month)...');
    const basePrice = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 5000, // $50.00
      recurring: {
        interval: 'month',
      },
    });
    console.log('✓ Base price created:', basePrice.id, '\n');

    // Step 4: Create metered AI usage price ($0.10 per request) with meter
    console.log('Step 4: Creating metered AI usage price ($0.10/request) with meter...');
    const usagePrice = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: 10, // $0.10
      recurring: {
        interval: 'month',
        usage_type: 'metered',
        meter: meter.id, // Required for new API version!
      },
    });
    console.log('✓ Usage price created:', usagePrice.id);
    console.log('  Meter:', meter.id, '\n');

    // Print summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✓ Stripe setup complete!\n');
    console.log('Add these to your Environment Variables:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STRIPE_BASE_PRICE_ID=' + basePrice.id);
    console.log('STRIPE_USAGE_PRICE_ID=' + usagePrice.id);
    console.log('STRIPE_METER_ID=' + meter.id);
    console.log('STRIPE_METER_EVENT_NAME=' + meter.event_name);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('Next steps:');
    console.log('1. Copy the above environment variables to your deployment');
    console.log('2. Restart your application');
    console.log('3. Test the subscription flow\n');

  } catch (error: any) {
    console.error('Error setting up Stripe:', error.message);
    if (error.type === 'StripeInvalidRequestError') {
      console.error('Details:', error.raw?.message);
    }
    process.exit(1);
  }
}

setupStripeMeters();