import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, tables } from "@/db";
import { getStripe } from "@/lib/stripe";

// Stripe redelivers events; stripe_events is the idempotency claim. The row
// is inserted BEFORE processing (atomic claim across concurrent deliveries)
// and deleted again if processing throws, so a genuine failure gets retried
// by Stripe instead of being silently swallowed as "already handled".
export async function POST(request: Request) {
  const rawBody = await request.arrayBuffer();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 401 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      Buffer.from(rawBody),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid webhook" },
      { status: 401 },
    );
  }

  const claimed = await db
    .insert(tables.stripeEvents)
    .values({ id: event.id })
    .onConflictDoNothing()
    .returning({ id: tables.stripeEvents.id });
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await handleEvent(event);
  } catch (e) {
    // Release the claim so Stripe's retry can reprocess this event.
    await db.delete(tables.stripeEvents).where(eq(tables.stripeEvents.id, event.id));
    console.error("stripe webhook processing failed", event.type, e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function mapSubscriptionStatus(
  status: Stripe.Subscription.Status,
): "active" | "past_due" | "canceled" {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "paused":
      return "past_due";
    default:
      return "canceled";
  }
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      const planId = session.metadata?.plan_id;
      if (!userId || !planId) break;

      const plan = await db.query.plans.findFirst({ where: eq(tables.plans.id, planId) });
      if (!plan) break;

      if (plan.kind === "credit_pack") {
        // Subscriptions are granted from invoice.paid instead — it also
        // covers renewals, so granting here too would double-count the
        // very first period.
        await db.execute(
          sql`select public.grant_credits(${userId}::uuid, ${plan.credits}, ${`Purchased: ${plan.name}`})`,
        );
      } else if (typeof session.subscription === "string") {
        await db
          .update(tables.profiles)
          .set({ stripeSubscriptionId: session.subscription, planId: plan.id, plan: plan.name })
          .where(eq(tables.profiles.id, userId));
      }
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const line = invoice.lines.data[0];
      const priceId = line?.pricing?.price_details?.price;
      const stripePriceId = typeof priceId === "string" ? priceId : priceId?.id;
      if (!customerId || !stripePriceId) break;

      const [plan, profile] = await Promise.all([
        db.query.plans.findFirst({ where: eq(tables.plans.stripePriceId, stripePriceId) }),
        db.query.profiles.findFirst({ where: eq(tables.profiles.stripeCustomerId, customerId) }),
      ]);
      if (!plan || !profile) break;

      await db.execute(
        sql`select public.grant_credits(${profile.id}::uuid, ${plan.credits}, ${`Renewal: ${plan.name}`})`,
      );

      const subscriptionId =
        typeof line.subscription === "string" ? line.subscription : line.subscription?.id;
      await db
        .update(tables.profiles)
        .set({
          planId: plan.id,
          plan: plan.name,
          subscriptionStatus: "active",
          // A renewal charge only happens if the sub wasn't set to lapse.
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date(line.period.end * 1000),
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        })
        .where(eq(tables.profiles.id, profile.id));
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      const item = sub.items.data[0];
      // Stripe portal cancellation defaults to "at period end" — `status`
      // stays "active" the whole time, so `cancel_at`/`cancel_at_period_end`
      // is the only signal a currently-active sub won't renew. Different API
      // versions surface this differently; check both.
      const cancelAtPeriodEnd = sub.cancel_at_period_end || Boolean(sub.cancel_at);

      await db
        .update(tables.profiles)
        .set({
          subscriptionStatus: mapSubscriptionStatus(sub.status),
          cancelAtPeriodEnd,
          ...(item ? { currentPeriodEnd: new Date(item.current_period_end * 1000) } : {}),
        })
        .where(eq(tables.profiles.stripeCustomerId, customerId));
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      // Balance is untouched — cancellation stops future accrual, it never
      // claws back credits already granted.
      await db
        .update(tables.profiles)
        .set({ subscriptionStatus: "canceled", cancelAtPeriodEnd: false })
        .where(eq(tables.profiles.stripeCustomerId, customerId));
      break;
    }

    default:
      break; // ignore event types we don't act on
  }
}
