import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { signAssetUrls } from "@/lib/assets";

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
] as const;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { kind } = await searchParams;
  const activeFilter = FILTERS.some((f) => f.value === kind) ? kind! : "all";

  const assets = await db.query.assets.findMany({
    where: and(
      eq(tables.assets.userId, user.id),
      ...(activeFilter !== "all" ? [eq(tables.assets.kind, activeFilter)] : []),
    ),
    orderBy: [desc(tables.assets.createdAt)],
    limit: 100,
  });

  const generationIds = [...new Set(assets.map((a) => a.generationId))];
  const generationRows = generationIds.length
    ? await db.query.generations.findMany({
        where: inArray(tables.generations.id, generationIds),
        columns: { id: true, prompt: true },
      })
    : [];
  const promptByGeneration = new Map(generationRows.map((g) => [g.id, g.prompt]));

  const signed = await signAssetUrls(assets.map((a) => a.storagePath));

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Library</h1>
        <div className="flex gap-1 rounded-lg border border-zinc-800 p-1">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={f.value === "all" ? "/library" : `/library?kind=${f.value}`}
              className={`rounded-md px-3 py-1 text-sm transition ${
                activeFilter === f.value
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800">
          <p className="text-sm text-zinc-500">Nothing here yet.</p>
          <Link
            href="/studio/image"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            Generate your first image
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {assets.map((asset) => {
            const url = signed.get(asset.storagePath);
            if (!url) return null;
            return (
              <div
                key={asset.id}
                className="group relative aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
              >
                <a href={url} target="_blank" rel="noreferrer" className="block h-full w-full">
                  {asset.kind === "video" ? (
                    <video src={url} muted loop playsInline preload="metadata"
                      className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived
                    <img src={url} alt={promptByGeneration.get(asset.generationId) ?? ""}
                      className="h-full w-full object-cover transition group-hover:scale-105" />
                  )}
                </a>
                {asset.kind === "image" && (
                  <Link
                    href={`/studio/video?source=${asset.id}`}
                    className="absolute right-2 top-2 rounded-lg bg-violet-600/90 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 transition hover:bg-violet-500 group-hover:opacity-100"
                  >
                    Animate →
                  </Link>
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[11px] text-zinc-200 opacity-0 transition group-hover:opacity-100">
                  {promptByGeneration.get(asset.generationId)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
