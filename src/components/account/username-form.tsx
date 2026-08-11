"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function UsernameForm({ initialUsername }: { initialUsername: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    // RLS grants UPDATE(username, avatar_url) to the owning user only.
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("profiles")
      .update({ username: username.trim() || null })
      .eq("id", user?.id ?? "");
    if (error) {
      setError(error.message);
    } else {
      setSaved(true);
      router.refresh();
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="flex items-end gap-2">
      <label className="block flex-1">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
          Username
        </span>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setSaved(false);
          }}
          placeholder="Not set"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-violet-500"
        />
      </label>
      <button
        type="submit"
        disabled={busy || username === initialUsername}
        className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-white transition hover:bg-zinc-900 disabled:opacity-40"
      >
        {busy ? "…" : "Save"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {saved && !error && <p className="text-xs text-emerald-400">Saved</p>}
    </form>
  );
}
