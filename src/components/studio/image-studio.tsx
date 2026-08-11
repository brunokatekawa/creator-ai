"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGenerationUpdates } from "@/lib/use-generation-updates";

export interface StudioModel {
  id: string;
  displayName: string;
  costConfig: { type: string; credits: number };
  paramsSchema: Record<string, unknown>;
}

export interface StudioPreset {
  id: string;
  slug: string;
  name: string;
  modelId: string;
  promptTemplate: string;
  thumbnailUrl: string | null;
}

export interface StudioJob {
  id: string;
  status: string;
  prompt: string;
  createdAt: string;
  error: string | null;
  outputs: { assetId: string; url: string }[];
}

// Friendlier labels for the flux-style image_size enum; aspect_ratio
// values (nano-banana) are already short and self-explanatory ("16:9").
const IMAGE_SIZE_LABELS: Record<string, string> = {
  square_hd: "1:1 HD",
  square: "1:1",
  portrait_4_3: "3:4",
  portrait_16_9: "9:16",
  landscape_4_3: "4:3",
  landscape_16_9: "16:9",
};

/** Which schema key (if any) drives the size/ratio dropdown for this model. */
function sizeParamKey(schema: Record<string, unknown>): "image_size" | "aspect_ratio" | null {
  if (Array.isArray(schema.image_size)) return "image_size";
  if (Array.isArray(schema.aspect_ratio)) return "aspect_ratio";
  return null;
}

// Gradient placeholders until presets get real thumbnails
const PRESET_GRADIENTS: Record<string, string> = {
  cinematic: "from-amber-900 to-zinc-900",
  "editorial-portrait": "from-stone-500 to-stone-900",
  "film-noir": "from-zinc-400 to-black",
  "golden-hour": "from-orange-500 to-rose-900",
  "cyberpunk-neon": "from-fuchsia-600 to-cyan-900",
  anime: "from-sky-500 to-indigo-900",
  watercolor: "from-teal-300 to-blue-800",
  "product-shot": "from-slate-300 to-slate-700",
  "isometric-3d": "from-lime-400 to-emerald-800",
  "pixel-art": "from-purple-500 to-violet-950",
};

export function ImageStudio({
  models,
  presets,
  initialJobs,
  userId,
  initialPresetId = null,
}: {
  models: StudioModel[];
  presets: StudioPreset[];
  initialJobs: StudioJob[];
  userId: string;
  initialPresetId?: string | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const [presetId, setPresetId] = useState<string | null>(initialPresetId);
  const [imageSize, setImageSize] = useState("");
  const [numImages, setNumImages] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useGenerationUpdates(userId, "image-studio-jobs");

  const activePreset = presets.find((p) => p.id === presetId) ?? null;
  const effectiveModelId = activePreset?.modelId ?? modelId;
  const model = models.find((m) => m.id === effectiveModelId);

  const sizeKey = model ? sizeParamKey(model.paramsSchema) : null;
  const sizeOptions = sizeKey ? (model!.paramsSchema[sizeKey] as string[]) : [];
  const showNumImages = Boolean(model?.paramsSchema.num_images);
  const effectiveImageSize = sizeOptions.includes(imageSize)
    ? imageSize
    : (sizeOptions[0] ?? "");

  const cost = !model
    ? 0
    : model.costConfig.type === "per_image"
      ? model.costConfig.credits * Math.min(Math.max(numImages, 1), 4)
      : model.costConfig.credits;

  async function submit() {
    if (!prompt.trim() || !model || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      if (sizeKey && effectiveImageSize) params[sizeKey] = effectiveImageSize;
      if (showNumImages) params.num_images = numImages;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: effectiveModelId,
          prompt: prompt.trim(),
          presetId: presetId ?? undefined,
          params,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-6 lg:flex-row">
      {/* ---- left: controls ---- */}
      <div className="flex w-full shrink-0 flex-col gap-5 lg:w-96">
        <div>
          <h1 className="text-xl font-semibold text-white light:text-zinc-900">Image Studio</h1>
          <p className="mt-1 text-sm text-zinc-400 light:text-zinc-600">
            Describe the subject; a preset handles the look.
          </p>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder={
            activePreset
              ? "e.g. a jazz trumpeter on a rooftop"
              : "Describe the full image…"
          }
          rows={4}
          className="w-full resize-none rounded-xl border border-zinc-800 light:border-zinc-300 bg-zinc-900/60 light:bg-white p-3 text-sm text-white light:text-zinc-900 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />

        {/* preset grid */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-zinc-300 light:text-zinc-700">Style preset</span>
            {activePreset && (
              <button
                onClick={() => setPresetId(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300 light:hover:text-zinc-700"
              >
                clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => setPresetId(p.id === presetId ? null : p.id)}
                title={p.promptTemplate}
                className={`relative aspect-square overflow-hidden rounded-lg bg-gradient-to-br text-left transition ${
                  PRESET_GRADIENTS[p.slug] ?? "from-zinc-700 to-zinc-900"
                } ${
                  p.id === presetId
                    ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-zinc-950 light:ring-offset-white"
                    : "opacity-80 hover:opacity-100"
                }`}
              >
                {p.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- public bucket URLs, no optimization needed at 100px
                  <img
                    src={p.thumbnailUrl}
                    alt={p.name}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1.5 py-1 text-[11px] font-medium leading-tight text-white">
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* model picker — hidden when a preset pins the model */}
        {!activePreset && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300 light:text-zinc-700">Model</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-900/60 light:bg-white px-3 py-2 text-sm text-white light:text-zinc-900 focus:border-violet-500 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} — {m.costConfig.credits}cr/img
                </option>
              ))}
            </select>
          </label>
        )}

        {(sizeKey || showNumImages) && (
          <div className="grid grid-cols-2 gap-3">
            {sizeKey && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-300 light:text-zinc-700">
                  {sizeKey === "image_size" ? "Size" : "Ratio"}
                </span>
                <select
                  value={effectiveImageSize}
                  onChange={(e) => setImageSize(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-900/60 light:bg-white px-3 py-2 text-sm text-white light:text-zinc-900 focus:border-violet-500 focus:outline-none"
                >
                  {sizeOptions.map((s) => (
                    <option key={s} value={s}>
                      {IMAGE_SIZE_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {showNumImages && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-300 light:text-zinc-700">Images</span>
                <select
                  value={numImages}
                  onChange={(e) => setNumImages(Number(e.target.value))}
                  className="w-full rounded-lg border border-zinc-800 light:border-zinc-300 bg-zinc-900/60 light:bg-white px-3 py-2 text-sm text-white light:text-zinc-900 focus:border-violet-500 focus:outline-none"
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={submitting || !prompt.trim()}
          className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Submitting…" : `Generate — ${cost} credit${cost === 1 ? "" : "s"}`}
        </button>
      </div>

      {/* ---- right: live jobs ---- */}
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 text-sm font-medium text-zinc-300 light:text-zinc-700">Recent</h2>
        {initialJobs.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-800 light:border-zinc-300 text-sm text-zinc-500">
            Your generations will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {initialJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobCard({ job }: { job: StudioJob }) {
  if (job.outputs.length > 0) {
    return (
      <>
        {job.outputs.map((out) => (
          <a
            key={out.assetId}
            href={out.url}
            target="_blank"
            rel="noreferrer"
            className="group relative block aspect-square overflow-hidden rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900 light:bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; next/image caching buys nothing */}
            <img
              src={out.url}
              alt={job.prompt}
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[11px] text-zinc-200 opacity-0 transition group-hover:opacity-100">
              {job.prompt}
            </span>
          </a>
        ))}
      </>
    );
  }

  return (
    <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-zinc-50 p-3">
      {job.status === "failed" ? (
        <>
          <span className="text-xs font-medium text-red-400">failed</span>
          <span className="line-clamp-3 text-center text-[11px] text-zinc-500">
            {job.error ?? "unknown error"}
          </span>
        </>
      ) : (
        <>
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 light:border-zinc-300 border-t-violet-400" />
          <span className="text-xs capitalize text-zinc-400 light:text-zinc-600">{job.status}</span>
          <span className="line-clamp-2 text-center text-[11px] text-zinc-600">
            {job.prompt}
          </span>
        </>
      )}
    </div>
  );
}
