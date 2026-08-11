import Stripe from "stripe";

// Lazy singleton: constructing eagerly at module scope makes `next build`
// fail whenever STRIPE_SECRET_KEY is unset, since route modules are
// evaluated during build's page-data collection, not just at request time.
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    // No pinned apiVersion — defaults to whatever version the SDK was built
    // against, which matches the account's dashboard default.
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}
