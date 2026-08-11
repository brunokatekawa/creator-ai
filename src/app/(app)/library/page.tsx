import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { signAssetUrls } from "@/lib/assets";
import { LibraryGrid, type LibraryAsset } from "@/components/library/library-grid";

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
        columns: {
          id: true,
          prompt: true,
          resolvedPrompt: true,
          modelId: true,
          presetId: true,
          creditsReserved: true,
        },
      })
    : [];
  const generationById = new Map(generationRows.map((g) => [g.id, g]));

  const modelIds = [...new Set(generationRows.map((g) => g.modelId))];
  const presetIds = [
    ...new Set(generationRows.map((g) => g.presetId).filter((id): id is string => Boolean(id))),
  ];
  const [modelRows, presetRows] = await Promise.all([
    modelIds.length
      ? db.query.models.findMany({
          where: inArray(tables.models.id, modelIds),
          columns: { id: true, displayName: true },
        })
      : Promise.resolve([]),
    presetIds.length
      ? db.query.presets.findMany({
          where: inArray(tables.presets.id, presetIds),
          columns: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const modelNameById = new Map(modelRows.map((m) => [m.id, m.displayName]));
  const presetNameById = new Map(presetRows.map((p) => [p.id, p.name]));

  const signed = await signAssetUrls(assets.map((a) => a.storagePath));

  const libraryAssets: LibraryAsset[] = assets
    .map((asset) => {
      const url = signed.get(asset.storagePath);
      const gen = generationById.get(asset.generationId);
      if (!url || !gen) return null;
      const item: LibraryAsset = {
        id: asset.id,
        generationId: asset.generationId,
        kind: asset.kind as "image" | "video",
        url,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        durationSeconds: asset.durationSeconds,
        sizeBytes: Number(asset.sizeBytes),
        createdAt: asset.createdAt.toISOString(),
        prompt: gen.prompt,
        resolvedPrompt: gen.resolvedPrompt,
        modelName: modelNameById.get(gen.modelId) ?? "Unknown model",
        presetName: gen.presetId ? (presetNameById.get(gen.presetId) ?? null) : null,
        creditsReserved: gen.creditsReserved,
      };
      return item;
    })
    .filter((a): a is LibraryAsset => a !== null);

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

      {libraryAssets.length === 0 ? (
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
        <LibraryGrid assets={libraryAssets} />
      )}
    </div>
  );
}
