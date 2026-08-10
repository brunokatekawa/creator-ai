import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { falAdapter } from "@/lib/providers/fal";
import { completeGeneration, failGeneration } from "@/lib/generation/complete";

// fal POSTs here when a queued job finishes. Deliveries are retried (10x over
// 2h) and may arrive more than once — everything downstream is idempotent.
export async function POST(request: Request) {
  const rawBody = await request.arrayBuffer();

  let parsed;
  try {
    parsed = await falAdapter.parseWebhook(request, rawBody);
  } catch (e) {
    // Bad signature / stale timestamp — reject so it never touches state
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid webhook" },
      { status: 401 },
    );
  }

  const generation = await db.query.generations.findFirst({
    where: eq(tables.generations.providerRequestId, parsed.providerRequestId),
  });

  if (!generation) {
    // Possibly a race: webhook arrived before our submit transaction saved the
    // provider_request_id. 404 makes fal retry later.
    return NextResponse.json({ error: "generation not found" }, { status: 404 });
  }

  if (generation.status === "completed" || generation.status === "failed") {
    return NextResponse.json({ ok: true }); // duplicate delivery
  }

  if (parsed.status.state === "completed") {
    await completeGeneration(generation, parsed.status.outputs);
  } else if (parsed.status.state === "failed") {
    await failGeneration(generation, parsed.status.error);
  }

  return NextResponse.json({ ok: true });
}
