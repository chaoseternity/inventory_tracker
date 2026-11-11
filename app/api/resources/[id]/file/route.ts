import { auth } from "@/lib/auth";
import { getResourceById } from "@/lib/db";
import { getResourceFile } from "@/lib/r2";
import { buildStoredFileResponse } from "@/lib/file-response";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const resourceId = Number(id);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const item = await getResourceById(resourceId);
  if (!item) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  const stored = await getResourceFile(item.r2_key);
  if (!stored) {
    return NextResponse.json(
      { error: "Resource file could not be retrieved from R2 object storage." },
      { status: 404 }
    );
  }

  return buildStoredFileResponse({
    stored,
    fileName: item.file_name,
    mimeType: item.file_type,
    forceDownload: req.nextUrl.searchParams.get("download") === "1",
    allowInlineImages: true,
  });
}

