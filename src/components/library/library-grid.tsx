"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export interface LibraryAsset {
  id: string;
  generationId: string;
  kind: "image" | "video";
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sizeBytes: number;
  createdAt: string;
  prompt: string;
  resolvedPrompt: string;
  modelName: string;
  presetName: string | null;
  creditsReserved: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function LibraryGrid({ assets }: { assets: LibraryAsset[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = assets.find((a) => a.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {assets.map((asset) => (
          <button
            key={asset.id}
            onClick={() => setSelectedId(asset.id)}
            className="group relative block aspect-square overflow-hidden rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900 light:bg-white text-left"
          >
            {asset.kind === "video" ? (
              <video
                src={asset.url}
                muted
                loop
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived
              <img
                src={asset.url}
                alt={asset.prompt}
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            )}
            {asset.kind === "image" && (
              <Link
                href={`/studio/video?source=${asset.id}`}
                onClick={(e) => e.stopPropagation()}
                className="absolute right-2 top-2 rounded-lg bg-violet-600/90 px-2.5 py-1 text-[11px] font-medium text-white opacity-0 transition hover:bg-violet-500 group-hover:opacity-100"
              >
                Animate →
              </Link>
            )}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[11px] text-zinc-200 opacity-0 transition group-hover:opacity-100">
              {asset.prompt}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/70 backdrop-blur-sm"
          onClick={() => setSelectedId(null)}
        >
          <div
            className="flex w-full max-w-5xl overflow-hidden bg-zinc-950 light:bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* media viewer stays dark regardless of theme — showing the
                content, not chrome, same as any photo/video lightbox */}
            <div className="flex min-w-0 flex-1 items-center justify-center bg-black p-4">
              {selected.kind === "video" ? (
                <video
                  src={selected.url}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-full max-w-full rounded-lg"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, full-res view
                <img
                  src={selected.url}
                  alt={selected.prompt}
                  className="max-h-full max-w-full rounded-lg object-contain"
                />
              )}
            </div>

            {/* metadata panel */}
            <div className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l border-zinc-800 light:border-zinc-200 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white light:text-zinc-900">Details</h2>
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-900 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900"
                >
                  ✕
                </button>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Prompt
                </span>
                <p className="text-sm leading-relaxed text-zinc-200 light:text-zinc-800">
                  {selected.prompt}
                </p>
              </div>

              {selected.resolvedPrompt !== selected.prompt && (
                <div>
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Full prompt sent to model
                  </span>
                  <p className="text-xs leading-relaxed text-zinc-500">
                    {selected.resolvedPrompt}
                  </p>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
                <dt className="text-zinc-500">Model</dt>
                <dd className="text-right text-zinc-200 light:text-zinc-800">{selected.modelName}</dd>

                {selected.presetName && (
                  <>
                    <dt className="text-zinc-500">Preset</dt>
                    <dd className="text-right text-zinc-200 light:text-zinc-800">{selected.presetName}</dd>
                  </>
                )}

                <dt className="text-zinc-500">Type</dt>
                <dd className="text-right capitalize text-zinc-200 light:text-zinc-800">{selected.kind}</dd>

                {selected.width && selected.height && (
                  <>
                    <dt className="text-zinc-500">Dimensions</dt>
                    <dd className="text-right text-zinc-200 light:text-zinc-800">
                      {selected.width} × {selected.height}
                    </dd>
                  </>
                )}

                {selected.durationSeconds && (
                  <>
                    <dt className="text-zinc-500">Duration</dt>
                    <dd className="text-right text-zinc-200 light:text-zinc-800">
                      {selected.durationSeconds}s
                    </dd>
                  </>
                )}

                <dt className="text-zinc-500">File size</dt>
                <dd className="text-right text-zinc-200 light:text-zinc-800">
                  {formatBytes(selected.sizeBytes)}
                </dd>

                <dt className="text-zinc-500">Cost</dt>
                <dd className="text-right text-zinc-200 light:text-zinc-800">
                  {selected.creditsReserved} credit
                  {selected.creditsReserved === 1 ? "" : "s"}
                </dd>

                <dt className="text-zinc-500">Created</dt>
                <dd className="text-right text-zinc-200 light:text-zinc-800">
                  {formatDate(selected.createdAt)}
                </dd>
              </dl>

              <div className="mt-auto flex flex-col gap-2 border-t border-zinc-800 light:border-zinc-200 pt-4">
                {selected.kind === "image" && (
                  <Link
                    href={`/studio/video?source=${selected.id}`}
                    className="rounded-lg bg-violet-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-violet-500"
                  >
                    Animate this image
                  </Link>
                )}
                <a
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-zinc-800 light:border-zinc-300 px-3 py-2 text-center text-sm text-zinc-300 light:text-zinc-700 transition hover:bg-zinc-900 light:hover:bg-zinc-100 hover:text-white light:hover:text-zinc-900"
                >
                  Open original
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
