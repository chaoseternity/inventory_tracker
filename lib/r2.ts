/**
 * Cloudflare R2 object storage helper for original SOP documents (.pdf, .docx, etc.).
 *
 * Uses the `SOP_BUCKET` R2 binding defined in `wrangler.toml` when running on Cloudflare
 * Workers, and returns `null` cleanly outside Cloudflare (e.g. local Next.js dev, Vercel,
 * or Jest unless a mock bucket is registered via `setTestSopBucket`).
 */
import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";

let testBucketOverride: R2Bucket | null | undefined = undefined;
let cachedBucket: R2Bucket | null = null;
let cloudflareContextUnavailable = false;

/**
 * Registers a mock R2 bucket for automated tests (pass `undefined` to clear the override,
 * or `null` to simulate an environment without an R2 binding).
 */
export function setTestSopBucket(bucket: R2Bucket | null | undefined): void {
  testBucketOverride = bucket;
  if (bucket === undefined) {
    cachedBucket = null;
  }
}

/**
 * Resolves the `SOP_BUCKET` R2 binding if available in the current runtime.
 */
export async function getSopBucket(): Promise<R2Bucket | null> {
  if (testBucketOverride !== undefined) return testBucketOverride;
  if (cachedBucket) return cachedBucket;

  // 1. Check globalThis binding (worker isolate)
  const globalEnv = (globalThis as any).env || (globalThis as any).__env__;
  if (globalEnv?.SOP_BUCKET) {
    cachedBucket = globalEnv.SOP_BUCKET as R2Bucket;
    return cachedBucket;
  }

  // 2. Check OpenNext Cloudflare Context
  if (!cloudflareContextUnavailable) {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const ctx = await getCloudflareContext({ async: true });
      if ((ctx?.env as any)?.SOP_BUCKET) {
        cachedBucket = (ctx.env as any).SOP_BUCKET as R2Bucket;
        return cachedBucket;
      }
    } catch {
      // Outside Cloudflare context (e.g. Jest, Vercel, or standalone Node script)
      cloudflareContextUnavailable = true;
    }
  }

  return null;
}

/** Validates that an R2 object key belongs to the `sop/` prefix and has no path traversal. */
export function isValidSopObjectKey(key: string | null | undefined): key is string {
  if (!key || typeof key !== "string") return false;
  if (!key.startsWith("sop/") || key.length > 512) return false;
  if (key.includes("..") || key.includes("\\")) return false;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** Generates a collision-free, sanitized R2 key under `sop/`. */
export function buildSopObjectKey(fileName: string): string {
  const baseName = fileName
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  const safeName = baseName && baseName.length > 0 ? baseName : "document.bin";
  const unique =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `sop/${Date.now()}-${unique}-${safeName}`;
}

/**
 * Uploads an original SOP file to R2 if `SOP_BUCKET` is bound.
 * Returns the stored `r2_key`, or `null` if R2 is not configured in this runtime.
 */
export async function putSopFile(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  contentType?: string | null
): Promise<string | null> {
  const bucket = await getSopBucket();
  if (!bucket) return null;

  const key = buildSopObjectKey(fileName);
  const cleanType = (contentType || "application/octet-stream").split(";")[0].trim() || "application/octet-stream";

  await bucket.put(key, data, {
    httpMetadata: {
      contentType: cleanType,
    },
    customMetadata: {
      originalFileName: fileName.slice(0, 255),
    },
  });

  return key;
}

export interface RetrievedSopFile {
  body: R2ObjectBody["body"] | ArrayBuffer;
  contentType: string;
  size: number;
  etag?: string;
}

/**
 * Retrieves an SOP file from R2 by its key. Returns `null` if R2 is unavailable,
 * the key is invalid, or the object does not exist.
 */
export async function getSopFile(key: string | null | undefined): Promise<RetrievedSopFile | null> {
  if (!isValidSopObjectKey(key)) return null;
  const bucket = await getSopBucket();
  if (!bucket) return null;

  const obj = await bucket.get(key);
  if (!obj) return null;

  return {
    body: obj.body,
    contentType: obj.httpMetadata?.contentType || "application/octet-stream",
    size: obj.size,
    etag: obj.httpEtag,
  };
}

/**
 * Best-effort deletion of an SOP file from R2. Never throws if R2 is unavailable
 * or the key does not exist so DB cleanup is never blocked.
 */
export async function deleteSopFile(key: string | null | undefined): Promise<void> {
  if (!isValidSopObjectKey(key)) return;
  try {
    const bucket = await getSopBucket();
    if (!bucket) return;
    await bucket.delete(key);
  } catch (err) {
    console.warn(`Notice: failed to delete R2 SOP object "${key}":`, err);
  }
}

