import { eq, sql, inArray, and } from "drizzle-orm";
import { db, tables } from "@/db";
import { createServiceClient } from "@/lib/supabase/server";
import type { ProviderOutput } from "@/lib/providers/types";

type GenerationRow = typeof tables.generations.$inferSelect;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * Persist provider outputs into our own Storage (fal URLs are temporary),
 * insert asset rows, mark the generation completed, and settle credits.
 * Idempotent: the status CAS makes a second delivery a no-op.
 */
export async function completeGeneration(
  generation: GenerationRow,
  outputs: ProviderOutput[],
): Promise<void> {
  if (outputs.length === 0) {
    return failGeneration(generation, "provider returned no outputs");
  }

  // CAS: only the first completion attempt proceeds
  const claimed = await db
    .update(tables.generations)
    .set({ status: "processing" })
    .where(
      and(
        eq(tables.generations.id, generation.id),
        inArray(tables.generations.status, ["queued", "processing"]),
      ),
    )
    .returning({ id: tables.generations.id });
  if (claimed.length === 0) return;

  const storage = createServiceClient().storage.from("assets");

  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i];
    const ext = EXT_BY_MIME[out.mimeType] ?? "bin";
    const path = `${generation.userId}/${generation.id}/${i}.${ext}`;

    const res = await fetch(out.url);
    if (!res.ok) {
      return failGeneration(generation, `output download failed: ${res.status}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());

    const { error } = await storage.upload(path, bytes, {
      contentType: out.mimeType,
      upsert: true, // safe: path is deterministic per generation+index
    });
    if (error) {
      return failGeneration(generation, `storage upload failed: ${error.message}`);
    }

    await db
      .insert(tables.assets)
      .values({
        userId: generation.userId,
        generationId: generation.id,
        kind: out.mimeType.startsWith("video/") ? "video" : "image",
        storagePath: path,
        mimeType: out.mimeType,
        width: out.width,
        height: out.height,
        durationSeconds: out.durationSeconds,
        sizeBytes: bytes.byteLength,
      })
      .onConflictDoNothing({ target: tables.assets.storagePath });
  }

  await db
    .update(tables.generations)
    .set({ status: "completed", completedAt: new Date(), error: null })
    .where(eq(tables.generations.id, generation.id));

  // Guarded in SQL against double-settle
  await db.execute(sql`select public.settle_credits(${generation.id}::uuid)`);
}

/** Mark failed and refund the reserve. Idempotent via the SQL-side guard. */
export async function failGeneration(
  generation: GenerationRow,
  errorMessage: string,
): Promise<void> {
  await db
    .update(tables.generations)
    .set({ status: "failed", error: errorMessage.slice(0, 500), completedAt: new Date() })
    .where(
      and(
        eq(tables.generations.id, generation.id),
        inArray(tables.generations.status, ["queued", "processing"]),
      ),
    );

  await db.execute(sql`select public.refund_credits(${generation.id}::uuid)`);
}
