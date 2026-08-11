import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-zinc-950 light:bg-white">
      <nav className="flex items-center justify-between px-6 py-4">
        <span className="text-lg font-semibold text-white light:text-zinc-900">
          Creator<span className="text-violet-400">AI</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <Link
              href="/studio/image"
              className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white transition hover:bg-violet-500"
            >
              Open Studio
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white transition hover:bg-violet-500"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pt-28 pb-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-white light:text-zinc-900">
          Cinematic AI, <span className="text-violet-400">one tap away</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400 light:text-zinc-600">
          Generate images and videos with curated presets — crash zooms, bullet
          time, editorial styles, and characters that stay consistent across
          every shot.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link
            href={user ? "/studio/image" : "/login"}
            className="rounded-lg bg-violet-600 px-6 py-3 font-medium text-white transition hover:bg-violet-500"
          >
            Start creating
          </Link>
          <Link
            href="/presets"
            className="rounded-lg border border-zinc-700 light:border-zinc-300 px-6 py-3 font-medium text-zinc-200 light:text-zinc-700 transition hover:border-zinc-500 light:hover:border-zinc-400"
          >
            Browse presets
          </Link>
        </div>
        <p className="mt-6 text-sm text-zinc-500">100 free credits on signup.</p>
      </section>
    </main>
  );
}
