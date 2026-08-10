import { createServiceClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL_S = 60 * 60;

/**
 * Batch-sign storage paths for the current user's assets. Callers must have
 * already scoped the paths via RLS-guarded queries — the service client here
 * only turns paths into time-limited URLs.
 */
export async function signAssetUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;

  const storage = createServiceClient().storage.from("assets");
  const { data, error } = await storage.createSignedUrls(paths, SIGNED_URL_TTL_S);
  if (error || !data) return map;

  for (const item of data) {
    if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
  }
  return map;
}
