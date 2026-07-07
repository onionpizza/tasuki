import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const PRICES = {
  standard: process.env.STRIPE_PRICE_STANDARD,
  premium: process.env.STRIPE_PRICE_PREMIUM,
};
const APP_URL = process.env.APP_URL || 'https://tasuki-eta.vercel.app';

function missingEnv() {
  const required = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_STANDARD', 'STRIPE_PRICE_PREMIUM', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  return required.filter((k) => !process.env[k]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const missing = missingEnv();
  if (missing.length) {
    console.error('Missing env vars:', missing);
    res.status(500).json({ error: 'Server misconfigured. Missing env: ' + missing.join(', ') });
    return;
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { plan, userId, email } = req.body || {};
    if (!userId || !email || !PRICES[plan]) {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }

    // 既存のStripe顧客IDがあれば再利用（重複顧客を防ぐ）
    let customerId;
    const { data: profile } = await supabase
      .from('profiles').select('stripe_customer_id').eq('id', userId).single();
    if (profile && profile.stripe_customer_id) customerId = profile.stripe_customer_id;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      ...(customerId ? { customer: customerId } : { customer_email: email }),
      client_reference_id: userId,
      metadata: { user_id: userId, plan },
      subscription_data: { metadata: { user_id: userId, plan } },
      success_url: `${APP_URL}/auth?success=true`,
      cancel_url: `${APP_URL}/auth?canceled=true`,
      locale: 'ja',
      allow_promotion_codes: true,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    res.status(500).json({ error: err.message });
  }
}
