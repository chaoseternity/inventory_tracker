import { auth } from "@/lib/auth";
import { getAllResources, createResource, getUserByEmail } from "@/lib/db";
import { putResourceFile, deleteResourceFile } from "@/lib/r2";
import { declaredContentLength, isUploadedFile, toErrorResponse, zodErrorMessage } from "@/lib/api-errors";
import type { EventSection } from "@/lib/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const MAX_RESOURCE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_MULTIPART_BYTES = MAX_RESOURCE_FILE_BYTES + 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".dll", ".scr", ".pif",
  ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".vbs", ".vbe",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".html", ".htm", ".xhtml", ".svg", ".svgz",
  ".php", ".py", ".rb", ".pl", ".jar", ".app", ".dmg",
]);

const SECTION_VALUES = ["photo", "video", "av"] as const;

const ResourceUploadSchema = z.object({
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(200, "Title cannot exceed 200 characters"),
  description: z
    .string()
    .trim()
    .max(2000, "Description cannot exceed 2000 characters")
    .optional(),
  section: z.enum(SECTION_VALUES, {
    error: "Section must be one of: photo, video, av",
  }),
  session_date: z
    .string()
    .trim()
    .max(32, "Session date is too long")
    .refine(
      (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v),
      "Session date must be in YYYY-MM-DD format"
    )
    .optional(),
});

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sectionParam = req.nextUrl.searchParams.get("section")?.toLowerCase();
  let sectionFilter: EventSection | undefined;
  if (sectionParam && sectionParam !== "all") {
    if (!SECTION_VALUES.includes(sectionParam as EventSection)) {
      return NextResponse.json({ error: "Invalid section filter" }, { status: 400 });
    }
    sectionFilter = sectionParam as EventSection;
  }

  try {
    const items = await getAllResources(sectionFilter);
    return NextResponse.json(items);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to load resource bank");
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentUser = session.user?.email ? await getUserByEmail(session.user.email) : undefined;
  const effectiveRole = currentUser?.role ?? session.user?.role;
  if (effectiveRole !== "admin" && effectiveRole !== "verified") {
    return NextResponse.json(
      { error: "Forbidden: Only verified members and admins can upload session materials." },
      { status: 403 }
    );
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Multipart form-data upload with a file is required." },
      { status: 400 }
    );
  }

  const contentLength = declaredContentLength(req);
  if (contentLength !== null && contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json(
      { error: "File size exceeds the 50MB upload limit." },
      { status: 413 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const rawFile = formData.get("file");
  if (!isUploadedFile(rawFile)) {
    return NextResponse.json({ error: "A file upload is required." }, { status: 400 });
  }

  if (rawFile.size <= 0) {
    return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 });
  }
  if (rawFile.size > MAX_RESOURCE_FILE_BYTES) {
    return NextResponse.json(
      { error: "File size exceeds the 50MB upload limit." },
      { status: 413 }
    );
  }

  const fileName = ((rawFile.name || "material.bin").split(/[\\/]/).pop() || "material.bin").slice(0, 255);
  const ext = getFileExtension(fileName);
  const fileType = (rawFile.type || "application/octet-stream").split(";")[0].trim().slice(0, 100);
  if (
    BLOCKED_EXTENSIONS.has(ext) ||
    fileType === "text/html" ||
    fileType === "image/svg+xml" ||
    fileType === "application/javascript" ||
    fileType === "text/javascript"
  ) {
    return NextResponse.json(
      { error: `File type "${ext || fileType}" is not permitted in the Resource Bank.` },
      { status: 400 }
    );
  }

  const fields = ResourceUploadSchema.safeParse({
    title:
      typeof formData.get("title") === "string" && (formData.get("title") as string).trim()
        ? formData.get("title")
        : fileName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
    description: typeof formData.get("description") === "string" ? formData.get("description") : undefined,
    section: typeof formData.get("section") === "string" ? (formData.get("section") as string).toLowerCase() : undefined,
    session_date:
      typeof formData.get("session_date") === "string" && (formData.get("session_date") as string).trim()
        ? formData.get("session_date")
        : undefined,
  });
  if (!fields.success) {
    return NextResponse.json({ error: zodErrorMessage(fields.error) }, { status: 400 });
  }

  const { title, description, section, session_date } = fields.data;
  const bytes = new Uint8Array(await rawFile.arrayBuffer());

  const r2Key = await putResourceFile(section, bytes, fileName, fileType);
  if (!r2Key) {
    return NextResponse.json(
      {
        error:
          "Cloudflare R2 storage (SOP_BUCKET) is not configured in this environment. Bind the R2 bucket before uploading session materials.",
      },
      { status: 503 }
    );
  }

  const uploadedBy = currentUser?.id ?? (session.user?.id ? Number(session.user.id) : null);

  try {
    const created = await createResource({
      title,
      description: description || null,
      section,
      session_date: session_date || null,
      file_name: fileName,
      file_type: fileType || "application/octet-stream",
      file_size: rawFile.size,
      r2_key: r2Key,
      uploaded_by: uploadedBy,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    await deleteResourceFile(r2Key);
    return toErrorResponse(err, "Failed to save resource material");
  }
}

