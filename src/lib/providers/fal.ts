import { fal } from "@fal-ai/client";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import type {
  ModelAdapter,
  ParsedWebhook,
  ProviderJobStatus,
  ProviderOutput,
  RegisteredModel,
  SubmitInput,
  SubmitResult,
} from "./types";

fal.config({ credentials: process.env.FAL_KEY });

// ---------------------------------------------------------------------------
// Webhook signature verification (per docs.fal.ai — ED25519 over
// "request_id\nuser_id\ntimestamp\nsha256hex(body)", keys from JWKS)
// ---------------------------------------------------------------------------

const JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // docs: cache at most 24h
const TIMESTAMP_LEEWAY_S = 300;

let jwksCache: { keys: { x: string }[]; fetchedAt: number } | null = null;

async function fetchJwks(): Promise<{ x: string }[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: { x: string }[] };
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function verifySignature(req: Request, rawBody: ArrayBuffer): Promise<void> {
  const requestId = req.headers.get("x-fal-webhook-request-id");
  const userId = req.headers.get("x-fal-webhook-user-id");
  const timestamp = req.headers.get("x-fal-webhook-timestamp");
  const signatureHex = req.headers.get("x-fal-webhook-signature");

  if (!requestId || !userId || !timestamp || !signatureHex) {
    throw new Error("missing fal webhook headers");
  }

  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > TIMESTAMP_LEEWAY_S) {
    throw new Error("webhook timestamp outside allowed window");
  }

  const bodyHash = createHash("sha256").update(Buffer.from(rawBody)).digest("hex");
  const message = Buffer.from(
    [requestId, userId, timestamp, bodyHash].join("\n"),
    "utf-8",
  );
  const signature = Buffer.from(signatureHex, "hex");

  const keys = await fetchJwks();
  for (const { x } of keys) {
    try {
      const key = createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x },
        format: "jwk",
      });
      // Ed25519 in node:crypto: algorithm must be null/undefined
      if (edVerify(null, message, key, signature)) return;
    } catch {
      continue;
    }
  }
  throw new Error("fal webhook signature verification failed");
}

// ---------------------------------------------------------------------------
// Payload mapping — fal models return either { images: [...] } or
// { video: { url } } (plus model-specific extras we ignore).
// ---------------------------------------------------------------------------

interface FalFile {
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

function mapOutputs(payload: unknown, params: Record<string, unknown>): ProviderOutput[] {
  const p = payload as { images?: FalFile[]; video?: FalFile; image?: FalFile } | null;
  if (!p) return [];

  const outputs: ProviderOutput[] = [];
  for (const img of p.images ?? (p.image ? [p.image] : [])) {
    outputs.push({
      url: img.url,
      mimeType: img.content_type ?? "image/png",
      width: img.width,
      height: img.height,
    });
  }
  if (p.video?.url) {
    outputs.push({
      url: p.video.url,
      mimeType: p.video.content_type ?? "video/mp4",
      durationSeconds: durationFromParams(params),
    });
  }
  return outputs;
}

function durationFromParams(params: Record<string, unknown>): number {
  const d = Number(params.duration ?? params.duration_seconds ?? 5);
  return Number.isFinite(d) && d > 0 ? d : 5;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const falAdapter: ModelAdapter = {
  provider: "fal",

  async submit(input: SubmitInput): Promise<SubmitResult> {
    const payload: Record<string, unknown> = {
      prompt: input.prompt,
      ...input.params,
    };
    if (input.negativePrompt) payload.negative_prompt = input.negativePrompt;
    if (input.sourceImageUrl) payload.image_url = input.sourceImageUrl;
    if (input.loraUrl) {
      payload.loras = [{ path: input.loraUrl, scale: 1 }];
    }

    const { request_id } = await fal.queue.submit(input.model.providerSlug, {
      input: payload,
      webhookUrl: input.webhookUrl,
    });

    return { providerRequestId: request_id };
  },

  async parseWebhook(req: Request, rawBody: ArrayBuffer): Promise<ParsedWebhook> {
    await verifySignature(req, rawBody);

    const body = JSON.parse(Buffer.from(rawBody).toString("utf-8")) as {
      request_id: string;
      status: "OK" | "ERROR";
      payload: unknown;
      error?: string;
      payload_error?: string;
    };

    if (body.status === "OK" && !body.payload_error) {
      return {
        providerRequestId: body.request_id,
        status: { state: "completed", outputs: mapOutputs(body.payload, {}) },
      };
    }
    return {
      providerRequestId: body.request_id,
      status: {
        state: "failed",
        error: body.error ?? body.payload_error ?? "unknown provider error",
      },
    };
  },

  async checkStatus(
    model: RegisteredModel,
    providerRequestId: string,
  ): Promise<ProviderJobStatus> {
    const status = await fal.queue.status(model.providerSlug, {
      requestId: providerRequestId,
      logs: false,
    });

    if (status.status === "COMPLETED") {
      const { data } = await fal.queue.result(model.providerSlug, {
        requestId: providerRequestId,
      });
      return { state: "completed", outputs: mapOutputs(data, {}) };
    }
    if (status.status === "IN_PROGRESS") return { state: "processing" };
    return { state: "queued" };
  },

  estimateCost(model: RegisteredModel, params: Record<string, unknown>): number {
    const cost = model.costConfig;
    switch (cost.type) {
      case "per_image": {
        const n = Number(params.num_images ?? 1);
        return cost.credits * (Number.isFinite(n) && n > 0 ? Math.min(n, 4) : 1);
      }
      case "per_second":
        return cost.credits * durationFromParams(params);
      case "flat":
        return cost.credits;
    }
  },
};

export function getAdapter(provider: string): ModelAdapter {
  if (provider === "fal") return falAdapter;
  throw new Error(`unknown provider: ${provider}`);
}
