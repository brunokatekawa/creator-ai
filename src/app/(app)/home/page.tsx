import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { signAssetUrls } from "@/lib/assets";
import { ActiveJobs, type ActiveJob } from "@/components/home/active-jobs";

export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  {
    href: "/studio/image",
    label: "Generate Image",
    description: "Text-to-image with one-tap style presets",
  },
  {
    href: "/studio/video",
    label: "Generate Video",
    description: "Camera moves, VFX, image-to-video",
  },
  {
    href: "/presets",
    label: "Browse Presets",
    description: "Curated looks across every model",
  },
  {
    href: "/characters",
    label: "Characters",
    description: "Consistent identity across shots",
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, recentAssets, activeGenerations] = await Promise.all([
    db.query.profiles.findFirst({ where: eq(tables.profiles.id, user.id) }),
    db.query.assets.findMany({
      where: eq(tables.assets.userId, user.id),
      orderBy: [desc(tables.assets.createdAt)],
      limit: 10,
    }),
    db.query.generations.findMany({
      where: and(
        eq(tables.generations.userId, user.id),
        inArray(tables.generations.status, ["queued", "processing"]),
      ),
      orderBy: [desc(tables.generations.createdAt)],
      limit: 8,
    }),
  ]);

  const generationIds = [...new Set(recentAssets.map((a) => a.generationId))];
  const generationRows = generationIds.length
    ? await db.query.generations.findMany({
        where: inArray(tables.generations.id, generationIds),
        columns: { id: true, prompt: true },
      })
    : [];
  const promptByGeneration = new Map(generationRows.map((g) => [g.id, g.prompt]));

  const signed = await signAssetUrls(recentAssets.map((a) => a.storagePath));

  const activeJobs: ActiveJob[] = activeGenerations.map((g) => ({
    id: g.id,
    status: g.status,
    prompt: g.prompt,
    modality: g.modality,
  }));

  const displayName = profile?.username || user.email || "there";
  const isSubscribed = profile?.subscriptionStatus === "active";

  return (
    <div className="p-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white light:text-zinc-900">
            Welcome back, {displayName}
          </h1>
          <p className="mt-1 text-sm text-zinc-400 light:text-zinc-600">
            {profile?.creditBalance ?? 0} credits
            {isSubscribed && <> · {profile?.plan}</>}
            {!isSubscribed && (
              <>
                {" "}
                ·{" "}
                <Link href="/account" className="text-violet-400 hover:text-violet-300">
                  Upgrade →
                </Link>
              </>
            )}
          </p>
        </div>
      </div>

      {/* quick actions */}
      <section className="mt-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/40 light:bg-zinc-50 p-4 transition hover:border-violet-500/50 hover:bg-zinc-900 light:hover:bg-white"
            >
              <p className="font-medium text-white light:text-zinc-900">{action.label}</p>
              <p className="mt-1 text-xs text-zinc-500">{action.description}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* in-progress jobs */}
      <div className="mt-6">
        <ActiveJobs jobs={activeJobs} userId={user.id} />
      </div>

      {/* recent creations */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-300 light:text-zinc-700">
            Recent creations
          </h2>
          {recentAssets.length > 0 && (
            <Link
              href="/library"
              className="text-xs text-zinc-500 hover:text-zinc-300 light:hover:text-zinc-700"
            >
              View all →
            </Link>
          )}
        </div>

        {recentAssets.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 light:border-zinc-300">
            <p className="text-sm text-zinc-500">Nothing here yet.</p>
            <Link
              href="/studio/image"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
            >
              Generate your first image
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {recentAssets.map((asset) => {
              const url = signed.get(asset.storagePath);
              if (!url) return null;
              const prompt = promptByGeneration.get(asset.generationId) ?? "";
              return (
                <Link
                  key={asset.id}
                  href="/library"
                  className="group relative block aspect-square overflow-hidden rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900 light:bg-white"
                >
                  {asset.kind === "video" ? (
                    <video
                      src={url}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived
                    <img
                      src={url}
                      alt={prompt}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[11px] text-zinc-200 opacity-0 transition group-hover:opacity-100">
                    {prompt}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
