import { auth } from "@/lib/auth";
import { getSOPDocumentById } from "@/lib/db";
import { getSopFile } from "@/lib/r2";
import { NextRequest, NextResponse } from "next/server";

function sanitizeDownloadName(name: string): string {
  const cleaned = name
    .replace(/[\r\n\t\0"\\]/g, "_")
    .replace(/^.*[\\/]/, "")
    .trim();
  return cleaned || "sop-document";
}

function toAsciiFallback(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "sop-document";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "Invalid document ID" }, { status: 400 });
  }

  const doc = await getSOPDocumentById(docId);
  if (!doc) {
    return NextResponse.json({ error: "SOP Document not found" }, { status: 404 });
  }
  if (!doc.r2_key) {
    return NextResponse.json(
      { error: "No original file is stored in object storage for this SOP document." },
      { status: 404 }
    );
  }

  const stored = await getSopFile(doc.r2_key);
  if (!stored) {
    return NextResponse.json(
      { error: "Original SOP file could not be retrieved from storage." },
      { status: 404 }
    );
  }

  const forceDownload = req.nextUrl.searchParams.get("download") === "1";
  const downloadName = sanitizeDownloadName(doc.file_name || `${doc.title}`);
  const asciiName = toAsciiFallback(downloadName);

  const rawType = (doc.file_type || stored.contentType || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const isPdf = rawType === "application/pdf" || downloadName.toLowerCase().endsWith(".pdf");

  // Only PDFs may be viewed inline; all other types (especially HTML/SVG/XML/DOCX) are forced as attachments.
  const dispositionType = !forceDownload && isPdf ? "inline" : "attachment";
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

