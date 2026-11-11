import { auth } from "@/lib/auth";
import { getResourceById, updateResource, deleteResource, getUserByEmail } from "@/lib/db";
import { toErrorResponse, validationErrorResponse } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpdateResourceSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  section: z.enum(["photo", "video", "av"]).optional(),
  session_date: z
    .string()
    .trim()
    .max(32)
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "Session date must be YYYY-MM-DD")
    .nullable()
    .optional(),
});

async function canModifyResource(
  session: { user: { email?: string | null; id?: string; role: string } },
  uploadedBy: number | null
): Promise<boolean> {
  const currentUser = session.user.email ? await getUserByEmail(session.user.email) : undefined;
  const role = currentUser?.role ?? session.user.role;
  if (role === "admin") return true;
  if (role !== "verified") return false;
  const userId = currentUser?.id ?? (session.user.id ? Number(session.user.id) : null);
  return userId !== null && uploadedBy !== null && userId === uploadedBy;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const resourceId = Number(id);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const item = await getResourceById(resourceId);
  if (!item) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  return NextResponse.json(item);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const resourceId = Number(id);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const existing = await getResourceById(resourceId);
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  if (!(await canModifyResource(session, existing.uploaded_by))) {
    return NextResponse.json(
      { error: "Forbidden: Only admins or the uploader can edit this resource." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateResourceSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const updated = await updateResource(resourceId, {
      ...parsed.data,
      session_date: parsed.data.session_date === "" ? null : parsed.data.session_date,
    });
    if (!updated) return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    return toErrorResponse(err, "Failed to update resource");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const resourceId = Number(id);
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    return NextResponse.json({ error: "Invalid resource ID" }, { status: 400 });
  }

  const existing = await getResourceById(resourceId);
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  if (!(await canModifyResource(session, existing.uploaded_by))) {
    return NextResponse.json(
      { error: "Forbidden: Only admins or the uploader can delete this resource." },
      { status: 403 }
    );
  }

  const result = await deleteResource(resourceId);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "Resource not found." ? 404 : 409 }
    );
  }
  return NextResponse.json({ success: true });
}

