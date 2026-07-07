import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Stripe署名検証には生のリクエストボディが必要なため、パースを無効化
export const config = { api: { bodyParser: false } };

function priceToPlan(priceId) {
  if (priceId === process.env.STRIPE_PRICE_STANDARD) return 'standard';
  if (priceId === process.env.STRIPE_PRICE_PREMIUM) return 'premium';
  return null;
}

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function setPlan(userId, plan, extra = {}) {
  if (!userId) return;
  const { error } = await supabase.from('profiles').update({ plan, ...extra }).eq('id', userId);
  if (error) console.error('profiles update error:', error);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  let event;
  try {
    const buf = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      // 決済完了 → plan を有効化
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || (session.metadata && session.metadata.user_id);
        const plan = session.metadata && session.metadata.plan;
        const extra = { stripe_customer_id: session.customer };
        if (session.subscription) extra.stripe_subscription_id = session.subscription;
        await setPlan(userId, plan, extra);
        break;
      }

      // プラン変更（アップグレード/ダウングレード）
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const priceId = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price.id;
        const plan = priceToPlan(priceId);
        let userId = sub.metadata && sub.metadata.user_id;
        if (!userId) {
          const { data } = await supabase.from('profiles').select('id').eq('stripe_customer_id', sub.customer).single();
          userId = data && data.id;
        }
        if (userId && plan && (sub.status === 'active' || sub.status === 'trialing')) {
          await setPlan(userId, plan, { stripe_subscription_id: sub.id, stripe_customer_id: sub.customer });
        }
        break;
      }

      // 解約 → free に戻す
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        let userId = sub.metadata && sub.metadata.user_id;
        if (!userId) {
          const { data } = await supabase.from('profiles').select('id').eq('stripe_customer_id', sub.customer).single();
          userId = data && data.id;
        }
        if (userId) await setPlan(userId, 'free', { stripe_subscription_id: null });
        break;
      }

      default:
        break;
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
