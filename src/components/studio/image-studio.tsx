"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export interface StudioModel {
  id: string;
  displayName: string;
  costConfig: { type: string; credits: number };
}

export interface StudioPreset {
  id: string;
  slug: string;
  name: string;
  modelId: string;
  promptTemplate: string;
}

export interface StudioJob {
  id: string;
  status: string;
  prompt: string;
  createdAt: string;
  error: string | null;
  outputs: { assetId: string; url: string }[];
}

const IMAGE_SIZES = [
  { value: "square_hd", label: "1:1 HD" },
  { value: "square", label: "1:1" },
  { value: "portrait_4_3", label: "3:4" },
  { value: "portrait_16_9", label: "9:16" },
  { value: "landscape_4_3", label: "4:3" },
  { value: "landscape_16_9", label: "16:9" },
];

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
  const [imageSize, setImageSize] = useState("square_hd");
  const [numImages, setNumImages] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Refresh throttle: realtime can fire several updates per job
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePreset = presets.find((p) => p.id === presetId) ?? null;
  const effectiveModelId = activePreset?.modelId ?? modelId;
  const model = models.find((m) => m.id === effectiveModelId);

  const cost = useMemo(() => {
    if (!model) return 0;
    if (model.costConfig.type === "per_image")
      return model.costConfig.credits * Math.min(Math.max(numImages, 1), 4);
    return model.costConfig.credits;
  }, [model, numImages]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  }, [router]);

  // Live job updates: RLS scopes the subscription to this user's rows.
  // The realtime socket must carry the user JWT *before* the channel joins —
  // with only the publishable key the connection is anonymous and RLS
  // silently filters out every event.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel("studio-jobs")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "generations",
            filter: `user_id=eq.${userId}`,
          },
          scheduleRefresh,
        )
        .subscribe();
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) supabase.realtime.setAuth(session.access_token);
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [userId, scheduleRefresh]);

  async function submit() {
    if (!prompt.trim() || !model || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: effectiveModelId,
          prompt: prompt.trim(),
          presetId: presetId ?? undefined,
          params: { image_size: imageSize, num_images: numImages },
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
          <h1 className="text-xl font-semibold text-white">Image Studio</h1>
          <p className="mt-1 text-sm text-zinc-400">
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
          className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-white placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
        />

        {/* preset grid */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-zinc-300">Style preset</span>
            {activePreset && (
              <button
                onClick={() => setPresetId(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
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
                    ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-zinc-950"
                    : "opacity-80 hover:opacity-100"
                }`}
              >
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
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">Model</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} — {m.costConfig.credits}cr/img
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">Size</span>
            <select
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              {IMAGE_SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-zinc-300">Images</span>
            <select
              value={numImages}
              onChange={(e) => setNumImages(Number(e.target.value))}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

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
        <h2 className="mb-3 text-sm font-medium text-zinc-300">Recent</h2>
        {initialJobs.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500">
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
            className="group relative block aspect-square overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
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
    <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
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
