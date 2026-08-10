import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { signAssetUrls } from "@/lib/assets";
import {
  VideoStudio,
  type SourceImage,
  type VideoJob,
  type VideoModel,
  type VideoPreset,
} from "@/components/studio/video-studio";

export const dynamic = "force-dynamic";

const VIDEO_MODALITIES = ["text_to_video", "image_to_video"] as const;

export default async function VideoStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; source?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { preset: presetSlug, source: sourceParam } = await searchParams;

  const [modelRows, presetRows, jobRows, imageAssets] = await Promise.all([
    db.query.models.findMany({
      where: and(
        eq(tables.models.enabled, true),
        inArray(tables.models.modality, [...VIDEO_MODALITIES]),
      ),
      orderBy: (m, { asc }) => [asc(m.sortOrder)],
    }),
    db.query.presets.findMany({
      where: and(
        eq(tables.presets.enabled, true),
        eq(tables.presets.modality, "image_to_video"),
      ),
      orderBy: (p, { asc }) => [asc(p.sortOrder)],
    }),
    db.query.generations.findMany({
      where: and(
        eq(tables.generations.userId, user.id),
        inArray(tables.generations.modality, [...VIDEO_MODALITIES]),
        gt(tables.generations.createdAt, sql`now() - interval '72 hours'`),
      ),
      orderBy: (g, { desc: d }) => [d(g.createdAt)],
      limit: 12,
    }),
    // Source picker: the user's recent still images
    db.query.assets.findMany({
      where: and(
        eq(tables.assets.userId, user.id),
        eq(tables.assets.kind, "image"),
      ),
      orderBy: [desc(tables.assets.createdAt)],
      limit: 24,
    }),
  ]);

  const videoAssets = jobRows.length
    ? await db.query.assets.findMany({
        where: inArray(
          tables.assets.generationId,
          jobRows.map((j) => j.id),
        ),
      })
    : [];

  const sourcePromptRows = imageAssets.length
    ? await db.query.generations.findMany({
        where: inArray(
          tables.generations.id,
          [...new Set(imageAssets.map((a) => a.generationId))],
        ),
        columns: { id: true, prompt: true },
      })
    : [];
  const promptByGeneration = new Map(sourcePromptRows.map((g) => [g.id, g.prompt]));

  const signed = await signAssetUrls([
    ...videoAssets.map((a) => a.storagePath),
    ...imageAssets.map((a) => a.storagePath),
  ]);

  const models: VideoModel[] = modelRows.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    modality: m.modality as VideoModel["modality"],
    costConfig: m.costConfig as VideoModel["costConfig"],
    paramsSchema: m.paramsSchema as VideoModel["paramsSchema"],
  }));

  const presets: VideoPreset[] = presetRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    modelId: p.modelId,
    promptTemplate: p.promptTemplate,
    thumbnailUrl: p.thumbnailUrl,
  }));

  const sourceImages: SourceImage[] = imageAssets
    .map((a) => ({
      id: a.id,
      url: signed.get(a.storagePath) ?? "",
      prompt: promptByGeneration.get(a.generationId) ?? "",
    }))
    .filter((s) => s.url);

  const jobs: VideoJob[] = jobRows.map((j) => ({
    id: j.id,
    status: j.status,
    prompt: j.prompt,
    error: j.error,
    outputs: videoAssets
      .filter((a) => a.generationId === j.id)
      .map((a) => ({ assetId: a.id, url: signed.get(a.storagePath) ?? "" }))
      .filter((o) => o.url),
  }));

  const initialPresetId =
    presets.find((p) => p.slug === presetSlug)?.id ?? null;
  const initialSourceAssetId =
    imageAssets.find((a) => a.id === sourceParam)?.id ?? null;

  return (
    <VideoStudio
      models={models}
      presets={presets}
      sourceImages={sourceImages}
      initialJobs={jobs}
      userId={user.id}
      initialPresetId={initialPresetId}
      initialSourceAssetId={initialSourceAssetId}
    />
  );
}
