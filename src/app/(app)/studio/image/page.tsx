import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { signAssetUrls } from "@/lib/assets";
import {
  ImageStudio,
  type StudioJob,
  type StudioModel,
  type StudioPreset,
} from "@/components/studio/image-studio";

export const dynamic = "force-dynamic";

export default async function ImageStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [modelRows, presetRows, jobRows] = await Promise.all([
    db.query.models.findMany({
      where: and(
        eq(tables.models.enabled, true),
        eq(tables.models.modality, "text_to_image"),
      ),
      orderBy: (m, { asc }) => [asc(m.sortOrder)],
    }),
    db.query.presets.findMany({
      where: and(
        eq(tables.presets.enabled, true),
        eq(tables.presets.modality, "text_to_image"),
      ),
      orderBy: (p, { asc }) => [asc(p.sortOrder)],
    }),
    db.query.generations.findMany({
      where: and(
        eq(tables.generations.userId, user.id),
        eq(tables.generations.modality, "text_to_image"),
        gt(tables.generations.createdAt, sql`now() - interval '24 hours'`),
      ),
      orderBy: (g, { desc: d }) => [d(g.createdAt)],
      limit: 24,
    }),
  ]);

  const assetRows = jobRows.length
    ? await db.query.assets.findMany({
        where: inArray(
          tables.assets.generationId,
          jobRows.map((j) => j.id),
        ),
        orderBy: [desc(tables.assets.createdAt)],
      })
    : [];

  const signed = await signAssetUrls(assetRows.map((a) => a.storagePath));

  const models: StudioModel[] = modelRows.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    costConfig: m.costConfig as StudioModel["costConfig"],
  }));

  const presets: StudioPreset[] = presetRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    modelId: p.modelId,
    promptTemplate: p.promptTemplate,
  }));

  const jobs: StudioJob[] = jobRows.map((j) => ({
    id: j.id,
    status: j.status,
    prompt: j.prompt,
    createdAt: j.createdAt.toISOString(),
    error: j.error,
    outputs: assetRows
      .filter((a) => a.generationId === j.id)
      .map((a) => ({ assetId: a.id, url: signed.get(a.storagePath) ?? "" }))
      .filter((o) => o.url),
  }));

  return (
    <ImageStudio models={models} presets={presets} initialJobs={jobs} userId={user.id} />
  );
}
