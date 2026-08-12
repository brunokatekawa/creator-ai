"use client";

import { useGenerationUpdates } from "@/lib/use-generation-updates";

export interface ActiveJob {
  id: string;
  status: string;
  prompt: string;
  modality: string;
}

const MODALITY_LABELS: Record<string, string> = {
  text_to_image: "Image",
  text_to_video: "Video",
  image_to_video: "Video",
};

/**
 * Live strip of queued/processing jobs. The realtime subscription refreshes
 * the whole route on any change, so finished jobs disappear from here and
 * surface in Recent creations without a manual reload.
 */
export function ActiveJobs({ jobs, userId }: { jobs: ActiveJob[]; userId: string }) {
  useGenerationUpdates(userId, "home-jobs");

  if (jobs.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-zinc-300 light:text-zinc-700">
        In progress
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex flex-col gap-2 rounded-xl border border-zinc-800 light:border-zinc-200 bg-zinc-900/60 light:bg-zinc-50 p-3"
          >
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-zinc-700 light:border-zinc-300 border-t-violet-400" />
              <span className="text-xs capitalize text-zinc-400 light:text-zinc-600">
                {MODALITY_LABELS[job.modality] ?? "Job"} · {job.status}
              </span>
            </div>
            <p className="line-clamp-2 text-xs text-zinc-500">{job.prompt}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
