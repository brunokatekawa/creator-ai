"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGenerationUpdates } from "@/lib/use-generation-updates";

export interface VideoModel {
  id: string;
  displayName: string;
  modality: "text_to_video" | "image_to_video";
  costConfig: { type: string; credits: number };
  paramsSchema: Record<string, { enum?: string[]; default?: string }>;
}

export interface VideoPreset {
  id: string;
  slug: string;
  name: string;
  category: string;
  modelId: string;
  promptTemplate: string;
  thumbnailUrl: string | null;
}

export interface SourceImage {
  id: string;
  url: string;
  prompt: string;
}

export interface VideoJob {
  id: string;
  status: string;
  prompt: string;
  error: string | null;
  outputs: { assetId: string; url: string }[];
}

const PRESET_GRADIENTS: Record<string, string> = {
  "crash-zoom": "from-red-600 to-zinc-900",
  "bullet-time": "from-emerald-500 to-zinc-900",
  "dolly-in": "from-sky-600 to-zinc-900",
  "dolly-out-reveal": "from-indigo-500 to-zinc-900",
  "fpv-drone": "from-orange-500 to-zinc-900",
  "orbit-360": "from-cyan-500 to-zinc-900",
  "earth-zoom-out": "from-blue-500 to-slate-950",
  "handheld-doc": "from-stone-500 to-zinc-900",
};

type Tab = "image_to_video" | "text_to_video";

export function VideoStudio({
  models,
  presets,
  sourceImages,
  initialJobs,
  userId,
  initialSourceAssetId = null,
  initialPresetId = null,
}: {
  models: VideoModel[];
  presets: VideoPreset[];
  sourceImages: SourceImage[];
  initialJobs: VideoJob[];
  userId: string;
  initialSourceAssetId?: string | null;
  initialPresetId?: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    initialPresetId &&
      presets.find((p) => p.id === initialPresetId) === undefined
      ? "text_to_video"
      : "image_to_video",
  );
  const [prompt, setPrompt] = useState("");
  const [presetId, setPresetId] = useState<string | null>(initialPresetId);
  const [sourceAssetId, setSourceAssetId] = useState<string | null>(
    initialSourceAssetId,
  );
  const [duration, setDuration] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useGenerationUpdates(userId, "video-studio-jobs");

  const tabModels = models.filter((m) => m.modality === tab);
  const activePreset = presets.find((p) => p.id === presetId) ?? null;
  const [modelId, setModelId] = useState(tabModels[0]?.id ?? "");
  const effectiveModelId = activePreset?.modelId ?? modelId;
  const model =
    models.find((m) => m.id === effectiveModelId && m.modality === tab) ??
    tabModels[0];

  const supportsDuration = Boolean(model?.paramsSchema?.duration);

  const cost = !model
    ? 0
    : model.costConfig.type === "per_second"
      ? model.costConfig.credits * Number(duration)
      : model.costConfig.credits;

  function switchTab(next: Tab) {
    setTab(next);
    setPresetId(null);
    setError(null);
    const first = models.find((m) => m.modality === next);
    if (first) setModelId(first.id);
  }

  async function submit() {
    if (!prompt.trim() || !model || submitting) return;
    if (tab === "image_to_video" && !sourceAssetId) {
      setError("pick a source image first");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      if (supportsDuration) params.duration = duration;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: model.id,
          prompt: prompt.trim(),
          presetId: presetId ?? undefined,
          sourceAssetId: tab === "image_to_video" ? sourceAssetId : undefined,
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

  const selectedSource = sourceImages.find((s) => s.id === sourceAssetId);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 p-6 lg:flex-row">
      {/* ---- left: controls ---- */}
      <div className="flex w-full shrink-0 flex-col gap-5 lg:w-96">
        <div>
          <h1 className="text-xl font-semibold text-white">Video Studio</h1>
          <div className="mt-3 flex gap-1 rounded-lg border border-zinc-800 p-1">
            {(
              [
                ["image_to_video", "Image to Video"],
                ["text_to_video", "Text to Video"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => switchTab(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                  tab === value
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* source image picker (i2v only) */}
        {tab === "image_to_video" && (
          <div>
            <span className="mb-2 block text-sm font-medium text-zinc-300">
              Source image
            </span>
            {sourceImages.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
                No images yet — generate one in the Image Studio first.
              </p>
            ) : (
              <div className="grid max-h-44 grid-cols-4 gap-2 overflow-y-auto pr-1">
                {sourceImages.map((img) => (
                  <button
                    key={img.id}
                    onClick={() =>
                      setSourceAssetId(img.id === sourceAssetId ? null : img.id)
                    }
                    title={img.prompt}
                    className={`relative aspect-square overflow-hidden rounded-lg transition ${
                      img.id === sourceAssetId
                        ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-zinc-950"
                        : "opacity-70 hover:opacity-100"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived */}
                    <img
                      src={img.url}
                      alt={img.prompt}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder={
            tab === "image_to_video"
              ? "Briefly describe the scene in the image…"
              : "Describe the video…"
          }
          rows={3}
          className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-white placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />

        {/* camera preset grid (i2v only) */}
        {tab === "image_to_video" && (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-medium text-zinc-300">
                Camera move
              </span>
              {activePreset && (
                <button
                  onClick={() => setPresetId(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id === presetId ? null : p.id)}
                  title={p.promptTemplate}
                  className={`relative aspect-square overflow-hidden rounded-lg bg-gradient-to-br text-left transition ${
                    PRESET_GRADIENTS[p.slug] ?? "from-zinc-700 to-zinc-900"
                  } ${
                    p.id === presetId
                      ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-zinc-950"
                      : "opacity-80 hover:opacity-100"
                  }`}
                >
                  {p.thumbnailUrl &&
                    (p.thumbnailUrl.endsWith(".mp4") ? (
                      <video
                        src={p.thumbnailUrl}
                        autoPlay
                        muted
                        loop
                        playsInline
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- public bucket URLs
                      <img
                        src={p.thumbnailUrl}
                        alt={p.name}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ))}
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[10px] font-medium leading-tight text-white">
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* model picker — hidden when a preset pins the model */}
        {!activePreset && tabModels.length > 1 && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">
              Model
            </span>
            <select
              value={model?.id ?? ""}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              {tabModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} —{" "}
                  {m.costConfig.type === "per_second"
                    ? `${m.costConfig.credits}cr/s`
                    : `${m.costConfig.credits}cr`}
                </option>
              ))}
            </select>
          </label>
        )}

        {supportsDuration && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">
              Duration
            </span>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="5">5 seconds</option>
              <option value="10">10 seconds</option>
            </select>
          </label>
        )}

        {error && (
          <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={
            submitting ||
            !prompt.trim() ||
            (tab === "image_to_video" && !sourceAssetId)
          }
          className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting
            ? "Submitting…"
            : `Generate — ${cost} credit${cost === 1 ? "" : "s"}`}
        </button>
        {selectedSource && tab === "image_to_video" && (
          <p className="truncate text-xs text-zinc-500">
            Animating: {selectedSource.prompt}
          </p>
        )}
      </div>

      {/* ---- right: live jobs ---- */}
      <div className="min-w-0 flex-1">
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Recent</h2>
        {initialJobs.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500">
            Your videos will appear here.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {initialJobs.map((job) => (
              <VideoJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VideoJobCard({ job }: { job: VideoJob }) {
  if (job.outputs.length > 0) {
    return (
      <>
        {job.outputs.map((out) => (
          <div
            key={out.assetId}
            className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
          >
            <video
              src={out.url}
              controls
              loop
              playsInline
              preload="metadata"
              className="aspect-video w-full bg-black object-contain"
            />
            <p className="truncate px-3 py-2 text-xs text-zinc-400">
              {job.prompt}
            </p>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      {job.status === "failed" ? (
        <>
          <span className="text-xs font-medium text-red-400">failed</span>
          <span className="line-clamp-3 text-center text-[11px] text-zinc-500">
            {job.error ?? "unknown error"}
          </span>
        </>
      ) : (
        <>
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-400" />
          <span className="text-xs capitalize text-zinc-400">{job.status}</span>
          <span className="line-clamp-2 text-center text-[11px] text-zinc-600">
            {job.prompt}
          </span>
        </>
      )}
    </div>
  );
}
