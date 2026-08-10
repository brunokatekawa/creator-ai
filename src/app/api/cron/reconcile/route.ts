import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, isNotNull, lt } from "drizzle-orm";
import { db, tables } from "@/db";
import { getAdapter } from "@/lib/providers/fal";
import { completeGeneration, failGeneration } from "@/lib/generation/complete";
import type { CostConfig, RegisteredModel } from "@/lib/providers/types";

// Safety net for lost webhooks: sweep stuck jobs and poll the provider
// directly. Run every few minutes (Vercel Cron or any scheduler).

const ORPHAN_THRESHOLD_MS = 10 * 60 * 1000; // queued, never submitted
const STUCK_THRESHOLD_MS = 2 * 60 * 1000; // submitted, no webhook yet
const BATCH = 25;

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let orphaned = 0;
  let reconciled = 0;
  let stillRunning = 0;

  // 1. Jobs that reserved credits but never reached the provider (crash
  //    between reserve and submit) — refund and fail.
  const orphans = await db.query.generations.findMany({
    where: and(
      eq(tables.generations.status, "queued"),
      isNull(tables.generations.providerRequestId),
      lt(tables.generations.createdAt, new Date(Date.now() - ORPHAN_THRESHOLD_MS)),
    ),
    limit: BATCH,
  });
  for (const gen of orphans) {
    await failGeneration(gen, "orphaned: never submitted to provider");
    orphaned++;
  }

  // 2. Jobs submitted but not finalized — poll provider status directly.
  const stuck = await db.query.generations.findMany({
    where: and(
      inArray(tables.generations.status, ["queued", "processing"]),
      isNotNull(tables.generations.providerRequestId),
      lt(tables.generations.createdAt, new Date(Date.now() - STUCK_THRESHOLD_MS)),
    ),
    limit: BATCH,
  });

  for (const gen of stuck) {
    const model = await db.query.models.findFirst({
      where: eq(tables.models.id, gen.modelId),
    });
    if (!model) continue;

    const registered: RegisteredModel = {
      id: model.id,
      provider: model.provider,
      providerSlug: model.providerSlug,
      modality: model.modality,
      costConfig: model.costConfig as CostConfig,
    };

    try {
      const status = await getAdapter(model.provider).checkStatus(
        registered,
        gen.providerRequestId!,
      );
      if (status.state === "completed") {
        await completeGeneration(gen, status.outputs);
        reconciled++;
      } else if (status.state === "failed") {
        await failGeneration(gen, status.error);
        reconciled++;
      } else {
        stillRunning++;
      }
    } catch (e) {
      // Provider 404s a request it no longer knows — treat as failed+refund
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("404")) {
        await failGeneration(gen, "provider lost the request");
        reconciled++;
      } else {
        stillRunning++;
      }
    }
  }

  return NextResponse.json({ orphaned, reconciled, stillRunning });
}
