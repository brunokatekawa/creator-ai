import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  style: "Style",
  camera: "Camera",
  vfx: "VFX",
};

// Fixed display order; unknown future categories sort last alphabetically
const CATEGORY_ORDER = ["style", "camera", "vfx"];

export default async function PresetsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;

  const presets = await db.query.presets.findMany({
    where: eq(tables.presets.enabled, true),
    orderBy: (p, { asc }) => [asc(p.sortOrder)],
  });

  const modelIds = [...new Set(presets.map((p) => p.modelId))];
  const models = modelIds.length
    ? await db.query.models.findMany({ where: inArray(tables.models.id, modelIds) })
    : [];
  const modelById = new Map(models.map((m) => [m.id, m]));

  const categories = [...new Set(presets.map((p) => p.category))].sort(
    (a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    },
  );

  const activeTab = categories.includes(tab ?? "") ? tab! : categories[0];
  const items = presets.filter((p) => p.category === activeTab);

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Presets</h1>
          <p className="mt-1 text-sm text-zinc-400">
            One-tap looks, curated per model. Pick one in the studio and just
            describe the subject.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-zinc-800 p-1">
          {categories.map((c) => (
            <Link
              key={c}
              href={`/presets?tab=${c}`}
              className={`rounded-md px-4 py-1.5 text-sm transition ${
                activeTab === c
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {CATEGORY_LABELS[c] ?? c}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => {
          const model = modelById.get(p.modelId);
          const cost =
            (model?.costConfig as { credits?: number } | null)?.credits ?? "?";
          return (
            <Link
              key={p.id}
              href={`${
                p.modality === "text_to_image" ? "/studio/image" : "/studio/video"
              }?preset=${p.slug}`}
              className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 transition hover:border-violet-500/50 hover:bg-zinc-900"
            >
              {p.thumbnailUrl && (
                <div className="aspect-[16/9] overflow-hidden">
                  {p.thumbnailUrl.endsWith(".mp4") ? (
                    <video
                      src={p.thumbnailUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- public bucket URLs
                    <img
                      src={p.thumbnailUrl}
                      alt={`${p.name} example`}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                  )}
                </div>
              )}
              <div className="p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-white">{p.name}</span>
                  <span className="text-xs text-zinc-500">
                    {model?.displayName} · {cost}cr
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                  {p.promptTemplate.replace("{subject}", "…")}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
