import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const APP_URL = process.env.APP_URL || 'https://tasuki-eta.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const { userId } = req.body || {};
    if (!userId) { res.status(400).json({ error: 'Invalid parameters' }); return; }

    const { data: profile } = await supabase
      .from('profiles').select('stripe_customer_id').eq('id', userId).single();
    if (!profile || !profile.stripe_customer_id) {
      res.status(400).json({ error: 'No subscription found' });
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${APP_URL}/app`,
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-portal-session error:', err);
    res.status(500).json({ error: err.message });
  }
}
