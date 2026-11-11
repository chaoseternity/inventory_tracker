/**
 * Cloudflare R2 object storage helper for SOP documents (`sop/`) and Resource Bank
 * session materials (`resources/`).
 *
 * Uses the `SOP_BUCKET` R2 binding defined in `wrangler.toml` when running on Cloudflare
 * Workers, and returns `null` cleanly outside Cloudflare (e.g. local Next.js dev, Vercel,
 * or Jest unless a mock bucket is registered via `setTestSopBucket`).
 */
import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import type { EventSection } from "./types";

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
 * Resolves the R2 bucket binding (`SOP_BUCKET`) if available in the current runtime.
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

function isValidPrefixedKey(key: string | null | undefined, prefix: string): key is string {
  if (!key || typeof key !== "string") return false;
  if (!key.startsWith(prefix) || key.length > 512) return false;
  if (key.includes("..") || key.includes("\\")) return false;
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function buildPrefixedKey(prefix: string, fileName: string): string {
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
  return `${prefix}${Date.now()}-${unique}-${safeName}`;
}

/** Validates that an R2 object key belongs to the `sop/` prefix and has no path traversal. */
export function isValidSopObjectKey(key: string | null | undefined): key is string {
  return isValidPrefixedKey(key, "sop/");
}

/** Validates that an R2 object key belongs to the `resources/` prefix and has no path traversal. */
export function isValidResourceObjectKey(key: string | null | undefined): key is string {
  return isValidPrefixedKey(key, "resources/");
}

/** Generates a collision-free, sanitized R2 key under `sop/`. */
export function buildSopObjectKey(fileName: string): string {
  return buildPrefixedKey("sop/", fileName);
}

/** Generates a collision-free, sanitized R2 key under `resources/<section>/`. */
export function buildResourceObjectKey(section: EventSection, fileName: string): string {
  return buildPrefixedKey(`resources/${section}/`, fileName);
}

async function putObject(
  key: string,
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  contentType?: string | null
): Promise<string | null> {
  const bucket = await getSopBucket();
  if (!bucket) return null;

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

/**
 * Uploads an original SOP file to R2 if `SOP_BUCKET` is bound.
 * Returns the stored `r2_key`, or `null` if R2 is not configured in this runtime.
 */
export async function putSopFile(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  contentType?: string | null
): Promise<string | null> {
  return putObject(buildSopObjectKey(fileName), data, fileName, contentType);
}

/**
 * Uploads a Resource Bank session material file to R2 under `resources/<section>/`.
 * Returns the stored `r2_key`, or `null` if R2 is not configured in this runtime.
 */
export async function putResourceFile(
  section: EventSection,
  data: ArrayBuffer | Uint8Array,
  fileName: string,
  contentType?: string | null
): Promise<string | null> {
  return putObject(buildResourceObjectKey(section, fileName), data, fileName, contentType);
}

export interface RetrievedR2File {
  body: R2ObjectBody["body"] | ArrayBuffer;
  contentType: string;
  size: number;
  etag?: string;
}

/** Backward-compatible type alias. */
export type RetrievedSopFile = RetrievedR2File;

async function getObject(key: string | null | undefined, prefix: string): Promise<RetrievedR2File | null> {
  if (!isValidPrefixedKey(key, prefix)) return null;
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
 * Retrieves an SOP file from R2 by its key. Returns `null` if R2 is unavailable,
 * the key is invalid, or the object does not exist.
 */
export async function getSopFile(key: string | null | undefined): Promise<RetrievedR2File | null> {
  return getObject(key, "sop/");
}

/**
 * Retrieves a Resource Bank file from R2 by its key. Returns `null` if R2 is unavailable,
 * the key is invalid, or the object does not exist.
 */
export async function getResourceFile(key: string | null | undefined): Promise<RetrievedR2File | null> {
  return getObject(key, "resources/");
}

async function deleteObject(key: string | null | undefined, prefix: string): Promise<void> {
  if (!isValidPrefixedKey(key, prefix)) return;
  try {
    const bucket = await getSopBucket();
    if (!bucket) return;
    await bucket.delete(key);
  } catch (err) {
    console.warn(`Notice: failed to delete R2 object "${key}":`, err);
  }
}

/**
 * Best-effort deletion of an SOP file from R2. Never throws if R2 is unavailable
 * or the key does not exist so DB cleanup is never blocked.
 */
export async function deleteSopFile(key: string | null | undefined): Promise<void> {
  return deleteObject(key, "sop/");
}

/**
 * Best-effort deletion of a Resource Bank file from R2. Never throws if R2 is unavailable
 * or the key does not exist so DB cleanup is never blocked.
 */
export async function deleteResourceFile(key: string | null | undefined): Promise<void> {
  return deleteObject(key, "resources/");
}
