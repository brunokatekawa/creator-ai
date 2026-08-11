"use client";

import { useState } from "react";

/** POST to a billing endpoint and redirect to the Stripe-hosted URL it returns. */
function useBillingRedirect(url: string, body?: Record<string, unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setBusy(false);
    }
  }

  return { trigger, busy, error };
}

export function SubscribeButton({
  planId,
  label = "Subscribe",
  className,
}: {
  planId: string;
  label?: string;
  className?: string;
}) {
  const { trigger, busy, error } = useBillingRedirect("/api/billing/checkout", { planId });

  return (
    <div>
      <button
        onClick={trigger}
        disabled={busy}
        className={
          className ??
          "w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
        }
      >
        {busy ? "…" : label}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function ManageBillingButton() {
  const { trigger, busy, error } = useBillingRedirect("/api/billing/portal");

  return (
    <div>
      <button
        onClick={trigger}
        disabled={busy}
        className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-900 disabled:opacity-50"
      >
        {busy ? "…" : "Manage billing"}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}
