import { and, desc, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { SubscribeButton, ManageBillingButton } from "@/components/account/billing-buttons";
import { UsernameForm } from "@/components/account/username-form";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

const TX_LABELS: Record<string, string> = {
  grant: "Credit",
  reserve: "Spent",
  settle: "",
  refund: "Refund",
};

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, plans, activity] = await Promise.all([
    db.query.profiles.findFirst({ where: eq(tables.profiles.id, user.id) }),
    db.query.plans.findMany({
      where: eq(tables.plans.enabled, true),
      orderBy: (p, { asc }) => [asc(p.sortOrder)],
    }),
    // settle rows are zero-delta bookkeeping markers — noise in a user-facing list
    db.query.creditTransactions.findMany({
      where: and(
        eq(tables.creditTransactions.userId, user.id),
        ne(tables.creditTransactions.kind, "settle"),
      ),
      orderBy: [desc(tables.creditTransactions.createdAt)],
      limit: 20,
    }),
  ]);

  const subscriptionPlans = plans.filter((p) => p.kind === "subscription");
  const creditPacks = plans.filter((p) => p.kind === "credit_pack");
  const isSubscribed = profile?.subscriptionStatus === "active";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-white light:text-zinc-900">Account</h1>

      {/* profile */}
      <section className="mt-6 rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/40 light:bg-zinc-50 p-5">
        <h2 className="mb-4 text-sm font-medium text-zinc-300 light:text-zinc-700">Profile</h2>
        <div className="mb-4">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Email
          </span>
          <p className="text-sm text-zinc-200 light:text-zinc-800">{user.email}</p>
        </div>
        <UsernameForm initialUsername={profile?.username ?? ""} />
      </section>

      {/* current plan */}
      <section className="mt-6 rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/40 light:bg-zinc-50 p-5">
        <h2 className="mb-4 text-sm font-medium text-zinc-300 light:text-zinc-700">Current plan</h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-white light:text-zinc-900">
              {isSubscribed ? profile?.plan : "Free"}
            </p>
            <p className="mt-1 text-sm text-zinc-400 light:text-zinc-600">
              {profile?.creditBalance ?? 0} credits
              {isSubscribed && profile?.currentPeriodEnd && (
                <>
                  {" "}
                  · {profile.cancelAtPeriodEnd ? "cancels" : "renews"}{" "}
                  {formatDate(profile.currentPeriodEnd)}
                </>
              )}
              {isSubscribed && profile?.cancelAtPeriodEnd && (
                <span className="ml-2 text-amber-400">won&apos;t renew</span>
              )}
              {profile?.subscriptionStatus === "past_due" && (
                <span className="ml-2 text-amber-400">payment past due</span>
              )}
              {profile?.subscriptionStatus === "canceled" && (
                <span className="ml-2 text-zinc-500">subscription canceled</span>
              )}
            </p>
          </div>
          {profile?.stripeCustomerId && (
            <div className="w-40">
              <ManageBillingButton />
            </div>
          )}
        </div>
      </section>

      {/* plans */}
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-zinc-300 light:text-zinc-700">Plans</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {subscriptionPlans.map((plan) => {
            const current = profile?.planId === plan.id && isSubscribed;
            return (
              <div
                key={plan.id}
                className={`rounded-xl border p-4 ${
                  current ? "border-violet-500" : "border-zinc-800 light:border-zinc-200"
                } bg-zinc-900/40 light:bg-zinc-50`}
              >
                <p className="font-medium text-white light:text-zinc-900">{plan.name}</p>
                <p className="mt-1 text-2xl font-semibold text-white light:text-zinc-900">
                  {formatCents(plan.priceUsdCents)}
                  <span className="text-sm font-normal text-zinc-500">/mo</span>
                </p>
                <p className="mt-1 text-sm text-zinc-400 light:text-zinc-600">{plan.credits} credits/mo</p>
                <div className="mt-4">
                  {current ? (
                    <span className="block rounded-lg border border-zinc-800 light:border-zinc-200 px-3 py-2 text-center text-sm text-zinc-500">
                      Current plan
                    </span>
                  ) : (
                    <SubscribeButton planId={plan.id} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* credit packs */}
      {creditPacks.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-zinc-300 light:text-zinc-700">Credit top-ups</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {creditPacks.map((pack) => (
              <div key={pack.id} className="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/40 light:bg-zinc-50 p-4">
                <p className="font-medium text-white light:text-zinc-900">{pack.name}</p>
                <p className="mt-1 text-2xl font-semibold text-white light:text-zinc-900">
                  {formatCents(pack.priceUsdCents)}
                </p>
                <p className="mt-1 text-sm text-zinc-400 light:text-zinc-600">one-time, no expiry</p>
                <div className="mt-4">
                  <SubscribeButton planId={pack.id} label="Buy" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* activity */}
      <section className="mt-6 rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/40 light:bg-zinc-50 p-5">
        <h2 className="mb-4 text-sm font-medium text-zinc-300 light:text-zinc-700">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-800/60 light:divide-zinc-200">
            {activity.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="text-zinc-200 light:text-zinc-800">
                    {TX_LABELS[tx.kind] ?? tx.kind}
                    {tx.note ? ` — ${tx.note}` : ""}
                  </span>
                  <p className="text-xs text-zinc-500">{formatDate(tx.createdAt)}</p>
                </div>
                <span
                  className={tx.delta >= 0 ? "text-emerald-400" : "text-zinc-400 light:text-zinc-600"}
                >
                  {tx.delta > 0 ? "+" : ""}
                  {tx.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
