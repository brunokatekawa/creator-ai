// ---------------------------------------------------------------------------
// Provider abstraction. No route handler ever talks to a generation provider
// directly — everything goes through a ModelAdapter. Models themselves live in
// the `models` table; the adapter only knows how to speak a provider's
// protocol, not which models exist.
// ---------------------------------------------------------------------------

export type Modality = "text_to_image" | "text_to_video" | "image_to_video";

/** Row shape from the `models` registry that adapters need to do their job. */
export interface RegisteredModel {
  id: string;
  provider: string;
  providerSlug: string;
  modality: Modality;
  costConfig: CostConfig;
}

export type CostConfig =
  | { type: "per_image"; credits: number }
  | { type: "per_second"; credits: number }
  | { type: "flat"; credits: number };

export interface SubmitInput {
  model: RegisteredModel;
  /** Fully resolved prompt (preset template + trigger words already applied). */
  prompt: string;
  negativePrompt?: string;
  /** Model-specific params, validated against the registry's paramsSchema. */
  params: Record<string, unknown>;
  /** Public URL of the source image for image_to_video. */
  sourceImageUrl?: string;
  /** LoRA weights to apply (Soul ID). */
  loraUrl?: string;
  /** Where the provider should POST completion callbacks. */
  webhookUrl: string;
}

export interface SubmitResult {
  providerRequestId: string;
}

export type ProviderJobStatus =
  | { state: "queued" }
  | { state: "processing" }
  | { state: "completed"; outputs: ProviderOutput[] }
  | { state: "failed"; error: string };

export interface ProviderOutput {
  /** Temporary provider URL — must be copied into our own storage promptly. */
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface ParsedWebhook {
  providerRequestId: string;
  status: ProviderJobStatus;
}

export interface ModelAdapter {
  readonly provider: string;

  /** Fire-and-forget submit to the provider's async queue. */
  submit(input: SubmitInput): Promise<SubmitResult>;

  /**
   * Verify authenticity and parse a webhook request. Throws on bad signature.
   * Takes the raw body because signatures are computed over exact bytes.
   */
  parseWebhook(req: Request, rawBody: ArrayBuffer): Promise<ParsedWebhook>;

  /** Poll fallback used by the reconciliation cron when webhooks are lost. */
  checkStatus(model: RegisteredModel, providerRequestId: string): Promise<ProviderJobStatus>;

  /**
   * Credits this job will cost, computed server-side from the registry.
   * Client-supplied costs are never trusted.
   */
  estimateCost(model: RegisteredModel, params: Record<string, unknown>): number;
}
