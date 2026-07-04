/**
 * stripe-backend-example.js
 * ============================================================
 * REFERENCE ONLY — this file does NOT run in the browser and is
 * NOT part of beastconverter.html. It's a working example of the
 * small backend BeastConverter needs for real Stripe payments.
 *
 * Deploy this as either:
 *   - A Node/Express server, or
 *   - A serverless function (Vercel, Netlify Functions, or a
 *     Cloudflare Worker — the Stripe SDK calls below are the same
 *     shape either way; only the request/response wrapper differs)
 *
 * WHY THIS HAS TO BE SEPARATE FROM beastconverter.html:
 * Both keys below are secrets. If either one ever ends up in a file
 * a browser downloads, anyone can view-source it and either (a)
 * create Stripe charges/sessions using your account, or (b) forge
 * fake "payment succeeded" webhook events your server would then
 * trust. That's why beastconverter.html only ever contains the
 * PUBLISHABLE key — this file is where the two real secrets go,
 * and it only ever runs on a server you control.
 * ============================================================
 */

const express = require('express');
const Stripe = require('stripe');

// ============== SECRETS — set these as environment variables on
// your hosting platform (Render/Railway/etc.), never hard-code them
// directly in this file if it's ever committed to a public repo. ==============
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_YOUR_SECRET_KEY_HERE'; // PLACEHOLDER
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_YOUR_WEBHOOK_SECRET_HERE'; // PLACEHOLDER
// ===================================================================

const stripe = Stripe(STRIPE_SECRET_KEY);
const app = express();

// CORS: beastconverter.com (frontend, on Vercel) and this backend
// (on Render/Railway/etc.) are different domains, so without this,
// the browser blocks the fetch() call from index.html entirely —
// this isn't optional. Restricted to your real domain, not '*'.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.beastconverter.com'; // PLACEHOLDER if your domain differs
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/**
 * ENDPOINT 1 — creates the Checkout Session.
 * Called by triggerStripeCheckout() in beastconverter.html.
 * Needs raw JSON body parsing (NOT the raw-body parsing endpoint 2 needs).
 */
app.post('/api/create-checkout-session', express.json(), async (req, res) => {
  try {
    const { success_url, cancel_url } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment', // one-time payment, not a subscription
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'dkk',
            product_data: {
              name: '24-Hour Beast Pass',
              description: 'Unlimited BeastConverter file conversions for 24 hours.',
            },
            unit_amount: 700, // Stripe uses the smallest currency unit — 700 = 7.00 DKK
          },
          quantity: 1,
        },
      ],
      success_url, // sent by the client — must include {CHECKOUT_SESSION_ID}
      cancel_url,
      // If you implement the EU withdrawal-right express-consent
      // checkbox discussed in terms.html §5, this is the place to
      // require it — e.g. via a Checkout custom_fields entry, and
      // store the consent decision on the session's metadata so you
      // have a record of it.
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error('Failed to create Checkout Session:', err);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

/**
 * ENDPOINT 2 — receives Stripe's webhook after payment.
 * This is the ONLY trustworthy confirmation that a payment actually
 * succeeded — everything the client tells beastconverter.html about
 * its own payment status (the ?beast_pass=success URL param) is a
 * convenience for the UI, not proof. If you want real proof (e.g. to
 * reconcile disputed "it didn't unlock" support requests), log what
 * this endpoint receives against your own order records.
 *
 * IMPORTANT: this route needs the RAW request body (not JSON-parsed)
 * for Stripe's signature verification to work — that's why it uses
 * express.raw() instead of express.json() like the endpoint above.
 */
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    // This is where you'd record the confirmed sale in your own
    // system (a database, a log, an email to yourself — whatever
    // "real" record-keeping you want beyond what Stripe's dashboard
    // already gives you). The client-side unlock already happened
    // via the success_url redirect; this is your server-side proof.
    console.log('Confirmed payment for session:', session.id, session.amount_total, session.currency);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stripe backend listening on port ${PORT}`));
