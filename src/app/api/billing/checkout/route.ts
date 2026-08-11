import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

const BodySchema = z.object({ planId: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const plan = await db.query.plans.findFirst({
    where: eq(tables.plans.id, parsed.data.planId),
  });
  if (!plan || !plan.enabled) {
    return NextResponse.json({ error: "unknown plan" }, { status: 400 });
  }
  if (!plan.stripePriceId) {
    return NextResponse.json({ error: "plan not yet configured" }, { status: 400 });
  }

  // stripe_customer_id has no client column-grant (same posture as
  // credit_balance) — Drizzle's `db` connects via DATABASE_URL and bypasses
  // RLS at the Postgres level, same as every other privileged write in the app.
  const profile = await db.query.profiles.findFirst({
    where: eq(tables.profiles.id, user.id),
    columns: { stripeCustomerId: true },
  });

  const stripe = getStripe();
  let customerId = profile?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await db
      .update(tables.profiles)
      .set({ stripeCustomerId: customerId })
      .where(eq(tables.profiles.id, user.id));
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const isSubscription = plan.kind === "subscription";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: isSubscription ? "subscription" : "payment",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: `${appUrl}/account?checkout=success`,
    cancel_url: `${appUrl}/account?checkout=canceled`,
    metadata: { supabase_user_id: user.id, plan_id: plan.id },
    ...(isSubscription
      ? { subscription_data: { metadata: { supabase_user_id: user.id, plan_id: plan.id } } }
      : {}),
  });

  if (!session.url) {
    return NextResponse.json({ error: "could not create checkout session" }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}
