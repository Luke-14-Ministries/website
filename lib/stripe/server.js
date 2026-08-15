// Server-only Stripe client.
//
// The secret key lives in the environment -- STRIPE_SECRET_KEY on Vercel, and
// .env.local for local development -- and never in the repo. It is Stripe's own
// key, scoped to the Stripe account; it is NOT the Supabase service-role key
// (that one stays inside Supabase, used only by the stripe-webhook Edge
// Function). Returns null when the key is absent, so the rest of the site still
// builds and runs before payments are switched on.

import Stripe from 'stripe';

let client = null;

export function getStripe() {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client = new Stripe(key);
  return client;
}
