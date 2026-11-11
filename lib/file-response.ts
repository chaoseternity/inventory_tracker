import { NextResponse } from "next/server";
import type { RetrievedR2File } from "./r2";

const SAFE_INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function sanitizeDownloadName(name: string): string {
  const cleaned = name
    .replace(/[\r\n\t\0"\\]/g, "_")
    .replace(/^.*[\\/]/, "")
    .trim();
  return cleaned || "document";
}

function toAsciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "document";
}

/**
 * Builds a hardened HTTP response for streaming a stored R2 file.
 * Only PDFs (and optionally safe raster images) may render inline; HTML/SVG/XML/Office
 * files are always forced as attachments with `CSP: sandbox` and `nosniff`.
 */
export function buildStoredFileResponse(params: {
  stored: RetrievedR2File;
  fileName: string;
  mimeType?: string | null;
  forceDownload: boolean;
  allowInlineImages?: boolean;
}): NextResponse {
  const { stored, fileName, mimeType, forceDownload, allowInlineImages = false } = params;
  const downloadName = sanitizeDownloadName(fileName);
  const asciiName = toAsciiFallback(downloadName);

  const rawType = (mimeType || stored.contentType || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const isPdf = rawType === "application/pdf" || downloadName.toLowerCase().endsWith(".pdf");
  const isSafeImage = allowInlineImages && SAFE_INLINE_IMAGE_TYPES.has(rawType);

  const dispositionType = !forceDownload && (isPdf || isSafeImage) ? "inline" : "attachment";
  const contentType = isPdf ? "application/pdf" : rawType || "application/octet-stream";

  const headers = new Headers();
  headers.set("Content-Type", contentType);
  headers.set(
    "Content-Disposition",
    `${dispositionType}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, max-age=3600");
  if (stored.size > 0) {
    headers.set("Content-Length", String(stored.size));
  }
  if (stored.etag) {
    headers.set("ETag", stored.etag);
  }
  if (dispositionType === "attachment") {
    headers.set("Content-Security-Policy", "sandbox");
  }

  return new NextResponse(stored.body as unknown as BodyInit, {
    status: 200,
    headers,
  });
}

