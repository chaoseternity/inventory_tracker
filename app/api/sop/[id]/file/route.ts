import { auth } from "@/lib/auth";
import { getSOPDocumentById } from "@/lib/db";
import { getSopFile } from "@/lib/r2";
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

  return buildStoredFileResponse({
    stored,
    fileName: doc.file_name || doc.title,
    mimeType: doc.file_type,
    forceDownload: req.nextUrl.searchParams.get("download") === "1",
  });
}
