import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, sql, count } from "drizzle-orm";
import { db, tables } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/providers/fal";
import type { CostConfig, RegisteredModel } from "@/lib/providers/types";

const BodySchema = z.object({
  modelId: z.string().uuid(),
  prompt: z.string().min(1).max(2000),
  presetId: z.string().uuid().optional(),
  characterId: z.string().uuid().optional(),
  sourceAssetId: z.string().uuid().optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(128),
});

const RATE_LIMIT_PER_MINUTE = 6;

/**
 * Keep only params the model's registry row actually declares, and only
 * enum-valued choices it actually allows. Prevents a client from smuggling
 * in a provider param (e.g. gpt-image-2's `quality`) that would push real
 * cost above what we billed in credits — `estimateCost` only ever sees
 * params that survive this filter. Two schema shapes exist in the registry
 * (bare array vs `{ enum: [...] }`); both are treated as an allow-list.
 */
function sanitizeParams(
  schema: Record<string, unknown>,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    const rule = schema[key];
    if (rule === undefined) continue; // not a declared param — drop

    const enumList = Array.isArray(rule)
      ? rule
      : Array.isArray((rule as { enum?: unknown[] })?.enum)
        ? (rule as { enum: unknown[] }).enum
        : null;
    if (enumList) {
      if (enumList.includes(value)) out[key] = value;
      continue;
    }

    const range = rule as { min?: number; max?: number };
    if (typeof range?.min === "number" || typeof range?.max === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      const lo = range.min ?? -Infinity;
      const hi = range.max ?? Infinity;
      out[key] = Math.min(Math.max(n, lo), hi);
      continue;
    }

    out[key] = value; // unrecognized rule shape — pass through
  }
  return out;
}

export async function POST(request: Request) {
  // ---- auth ----
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // ---- kill switch ----
  if (process.env.GENERATION_KILL_SWITCH === "true") {
    return NextResponse.json({ error: "generation temporarily disabled" }, { status: 503 });
  }

  // ---- validate ----
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  // ---- idempotency: same key → return the existing generation ----
  const existing = await db.query.generations.findFirst({
    where: and(
      eq(tables.generations.userId, user.id),
      eq(tables.generations.idempotencyKey, body.idempotencyKey),
    ),
  });
  if (existing) {
    return NextResponse.json({ generationId: existing.id, status: existing.status });
  }

  // ---- rate limit (per user per minute) ----
  const [{ value: recentCount }] = await db
    .select({ value: count() })
    .from(tables.generations)
    .where(
      and(
        eq(tables.generations.userId, user.id),
        gt(tables.generations.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
  if (recentCount >= RATE_LIMIT_PER_MINUTE) {
    return NextResponse.json({ error: "rate limit exceeded, slow down" }, { status: 429 });
  }

  // ---- load model from registry ----
  const model = await db.query.models.findFirst({
    where: and(eq(tables.models.id, body.modelId), eq(tables.models.enabled, true)),
  });
  if (!model) return NextResponse.json({ error: "unknown model" }, { status: 400 });

  // ---- resolve preset ----
  let resolvedPrompt = body.prompt;
  let negativePrompt: string | undefined;
  let mergedParams: Record<string, unknown> = { ...body.params };

  if (body.presetId) {
    const preset = await db.query.presets.findFirst({
      where: and(eq(tables.presets.id, body.presetId), eq(tables.presets.enabled, true)),
    });
    if (!preset || preset.modelId !== model.id) {
      return NextResponse.json({ error: "unknown preset for model" }, { status: 400 });
    }
    resolvedPrompt = preset.promptTemplate.replaceAll("{subject}", body.prompt);
    negativePrompt = preset.negativePrompt ?? undefined;
    mergedParams = { ...(preset.params as Record<string, unknown>), ...body.params };
  }

  // ---- character (Soul ID) trigger word + LoRA ----
  let loraUrl: string | undefined;
  if (body.characterId) {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(tables.characters.id, body.characterId),
        eq(tables.characters.userId, user.id),
        eq(tables.characters.status, "ready"),
      ),
    });
    if (!character?.loraUrl) {
      return NextResponse.json({ error: "character not ready" }, { status: 400 });
    }
    loraUrl = character.loraUrl;
    resolvedPrompt = `${character.triggerWord}, ${resolvedPrompt}`;
  }

  // ---- source image for image_to_video ----
  let sourceImageUrl: string | undefined;
  if (model.modality === "image_to_video") {
    if (!body.sourceAssetId) {
      return NextResponse.json({ error: "sourceAssetId required for image-to-video" }, { status: 400 });
    }
    const asset = await db.query.assets.findFirst({
      where: and(
        eq(tables.assets.id, body.sourceAssetId),
        eq(tables.assets.userId, user.id),
      ),
    });
    if (!asset) return NextResponse.json({ error: "unknown source asset" }, { status: 400 });
    const { data: signed } = await supabase.storage
      .from("assets")
      .createSignedUrl(asset.storagePath, 60 * 60);
    if (!signed) return NextResponse.json({ error: "could not sign source asset" }, { status: 500 });
    sourceImageUrl = signed.signedUrl;
  }

  // ---- strip any param the model doesn't declare, or an enum value it
  // doesn't allow, before cost is estimated from it ----
  mergedParams = sanitizeParams(
    model.paramsSchema as Record<string, unknown>,
    mergedParams,
  );

  // ---- cost: always computed server-side from the registry ----
  const adapter = getAdapter(model.provider);
  const registered: RegisteredModel = {
    id: model.id,
    provider: model.provider,
    providerSlug: model.providerSlug,
    modality: model.modality,
    costConfig: model.costConfig as CostConfig,
  };
  const cost = adapter.estimateCost(registered, mergedParams);

  // ---- daily spend cap ----
  const capRow = await db.execute(
    sql`select public.credits_spent_today(${user.id}::uuid) as spent`,
  );
  const spentToday = Number((capRow as unknown as { spent: number }[])[0]?.spent ?? 0);
  const dailyCap = Number(process.env.MAX_CREDITS_PER_USER_PER_DAY ?? 500);
  if (spentToday + cost > dailyCap) {
    return NextResponse.json({ error: "daily spend cap reached" }, { status: 429 });
  }

  // ---- create job ----
  let generationId: string;
  try {
    const [row] = await db
      .insert(tables.generations)
      .values({
        userId: user.id,
        modality: model.modality,
        modelId: model.id,
        presetId: body.presetId,
        characterId: body.characterId,
        sourceAssetId: body.sourceAssetId,
        prompt: body.prompt,
        resolvedPrompt,
        params: mergedParams,
        creditsReserved: cost,
        idempotencyKey: body.idempotencyKey,
      })
      .returning({ id: tables.generations.id });
    generationId = row.id;
  } catch {
    // unique(user_id, idempotency_key) race — re-read and return
    const raced = await db.query.generations.findFirst({
      where: and(
        eq(tables.generations.userId, user.id),
        eq(tables.generations.idempotencyKey, body.idempotencyKey),
      ),
    });
    if (raced) return NextResponse.json({ generationId: raced.id, status: raced.status });
    return NextResponse.json({ error: "could not create generation" }, { status: 500 });
  }

  // ---- reserve credits (raises on insufficient balance) ----
  try {
    await db.execute(
      sql`select public.reserve_credits(${user.id}::uuid, ${cost}, ${generationId}::uuid)`,
    );
  } catch (e) {
    await db
      .update(tables.generations)
      .set({ status: "failed", error: "insufficient credits" })
      .where(eq(tables.generations.id, generationId));
    const msg = e instanceof Error && e.message.includes("insufficient")
      ? "insufficient credits"
      : "credit reservation failed";
    return NextResponse.json({ error: msg }, { status: 402 });
  }

  // ---- submit to provider ----
  try {
    const { providerRequestId } = await adapter.submit({
      model: registered,
      prompt: resolvedPrompt,
      negativePrompt,
      params: mergedParams,
      sourceImageUrl,
      loraUrl,
      webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/fal`,
    });

    await db
      .update(tables.generations)
      .set({ providerRequestId })
      .where(eq(tables.generations.id, generationId));
  } catch (e) {
    // Submit failed — refund immediately, never charge for nothing
    await db
      .update(tables.generations)
      .set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 500) : "submit failed" })
      .where(eq(tables.generations.id, generationId));
    await db.execute(sql`select public.refund_credits(${generationId}::uuid)`);
    return NextResponse.json({ error: "provider submit failed" }, { status: 502 });
  }

  return NextResponse.json({ generationId, status: "queued", cost }, { status: 202 });
}
