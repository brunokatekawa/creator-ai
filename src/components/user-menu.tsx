"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";

const noopSubscribe = () => () => {};

/** True only after client-side hydration — avoids a mismatch flashing the
 * wrong theme label, without the synchronous setState-in-effect anti-pattern. */
function useHasMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function UserMenu({
  email,
  username,
}: {
  email: string;
  username: string | null;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const mounted = useHasMounted();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  const label = username || email;
  const initial = (username || email || "?").charAt(0).toUpperCase();
  const isDark = resolvedTheme !== "light";

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-lg border border-zinc-800 light:border-zinc-200 bg-zinc-900 light:bg-white py-1 shadow-xl">
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-zinc-300 light:text-zinc-700 transition hover:bg-zinc-800 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900"
          >
            Account
          </Link>
          <button
            onClick={() => mounted && setTheme(isDark ? "light" : "dark")}
            disabled={!mounted}
            className="block w-full px-3 py-2 text-left text-sm text-zinc-300 light:text-zinc-700 transition hover:bg-zinc-800 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900 disabled:opacity-50"
          >
            {mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Switch theme"}
          </button>
          <button
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-sm text-zinc-300 light:text-zinc-700 transition hover:bg-zinc-800 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900"
          >
            Log out
          </button>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-zinc-900 light:hover:bg-zinc-100"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-300 light:text-zinc-700">
          {label}
        </span>
      </button>
    </div>
  );
}
