/**
 * Integration tests for Section Resource Bank API routes (/api/resources):
 * - Auth & role permissions (viewer read-only, verified upload/manage-own, admin full control)
 * - Section filtering (photo, video, av)
 * - Blocked dangerous file types (.html, .svg, .exe) & unbound R2 503 handling
 * - R2 upload, forced-attachment vs inline preview headers, metadata PATCH, and DELETE cleanup
 */
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { auth } from "@/lib/auth";
import { upsertUser } from "@/lib/db";
import { setTestSopBucket } from "@/lib/r2";
import { GET as listResources, POST as uploadResource } from "@/app/api/resources/route";
import { PATCH as patchResource, DELETE as deleteResource } from "@/app/api/resources/[id]/route";
import { GET as getResourceFileRoute } from "@/app/api/resources/[id]/file/route";
import { NextRequest } from "next/server";
import type { R2Bucket } from "@cloudflare/workers-types";

interface StoredEntry {
  bytes: Uint8Array;
  contentType: string;
}

function createMockR2Bucket() {
  const store = new Map<string, StoredEntry>();
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      opts?: { httpMetadata?: { contentType?: string } }
    ) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
      store.set(key, {
        bytes: new Uint8Array(bytes),
        contentType: opts?.httpMetadata?.contentType || "application/octet-stream",
      });
      return { key, size: bytes.byteLength };
    },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.bytes.byteLength,
        httpEtag: `"etag-${entry.bytes.byteLength}"`,
        httpMetadata: { contentType: entry.contentType },
        body: entry.bytes.buffer.slice(
          entry.bytes.byteOffset,
          entry.bytes.byteOffset + entry.bytes.byteLength
        ),
      };
    },
    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) store.delete(k);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

async function makeUser(name: string, role: "admin" | "verified" | "viewer") {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  return upsertUser({
    name,
    email: `${slug}@school.edu`,
    google_id: `g_${slug}`,
    image: null,
    provider: "google",
    role,
  });
}

function asUser(user: { id: number; email: string; name: string }, role: "admin" | "verified" | "viewer") {
  (auth as jest.Mock).mockResolvedValue({
    user: { id: String(user.id), email: user.email, name: user.name, role },
  });
}

describe("Section Resource Bank API", () => {
  beforeEach(() => {
    setTestDb(makeTestDb());
    (auth as jest.Mock).mockResolvedValue(null);
    setTestSopBucket(null);
  });

  afterEach(() => {
    setTestDb(null);
    setTestSopBucket(undefined);
  });

  test("rejects unauthenticated requests with 401 and returns 503 when R2 is unbound", async () => {
    const res = await listResources(new NextRequest("http://localhost/api/resources"));
    expect(res.status).toBe(401);

    const verified = await makeUser("Photo IC", "verified");
    asUser(verified, "verified");

    const fd = new FormData();
    fd.append(
      "file",
      new File(["slides"], "Exposure_101.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    fd.append("title", "Exposure 101 Slides");
    fd.append("section", "photo");

    const unboundRes = await uploadResource(
      new NextRequest("http://localhost/api/resources", { method: "POST", body: fd })
    );
    expect(unboundRes.status).toBe(503);
  });

  test("blocks viewer uploads and dangerous file types without touching R2", async () => {
    const { bucket, store } = createMockR2Bucket();
    setTestSopBucket(bucket);

    const viewer = await makeUser("Junior Viewer", "viewer");
    asUser(viewer, "viewer");

    const fdViewer = new FormData();
    fdViewer.append("file", new File(["pdf"], "Notes.pdf", { type: "application/pdf" }));
    fdViewer.append("section", "av");
    const viewerUpload = await uploadResource(
      new NextRequest("http://localhost/api/resources", { method: "POST", body: fdViewer })
    );
    expect(viewerUpload.status).toBe(403);

    const admin = await makeUser("Club Admin", "admin");
    asUser(admin, "admin");

    for (const [name, mime] of [
      ["payload.html", "text/html"],
      ["icon.svg", "image/svg+xml"],
      ["script.exe", "application/octet-stream"],
    ]) {
      const fdBad = new FormData();
      fdBad.append("file", new File(["bad"], name, { type: mime }));
      fdBad.append("section", "video");
      const badRes = await uploadResource(
        new NextRequest("http://localhost/api/resources", { method: "POST", body: fdBad })
      );
      expect(badRes.status).toBe(400);
    }
    expect(store.size).toBe(0);
  });

  test("supports section uploads, filtering, secure downloads, ownership edit/delete, and R2 cleanup", async () => {
    const { bucket, store } = createMockR2Bucket();
    setTestSopBucket(bucket);

    const photoUser = await makeUser("Alice Photo", "verified");
    const videoUser = await makeUser("Bob Video", "verified");
    const viewer = await makeUser("Charlie Viewer", "viewer");
    const admin = await makeUser("Admin Ada", "admin");

    // 1. Photo section verified user uploads PPTX slides
    asUser(photoUser, "verified");
    const fdPhoto = new FormData();
    fdPhoto.append(
      "file",
      new File(["pptx-binary"], "Framing_Workshop.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      })
    );
    fdPhoto.append("title", "Framing Workshop");
    fdPhoto.append("section", "photo");
    fdPhoto.append("session_date", "2026-11-11");
    fdPhoto.append("description", "Rule of thirds and aperture slides.");

    const photoRes = await uploadResource(
      new NextRequest("http://localhost/api/resources", { method: "POST", body: fdPhoto })
    );
    expect(photoRes.status).toBe(201);
    const photoItem = await photoRes.json();
    expect(photoItem.section).toBe("photo");
    expect(photoItem.r2_key).toMatch(/^resources\/photo\/.*Framing_Workshop\.pptx$/);
    expect(store.has(photoItem.r2_key)).toBe(true);

    // 2. Video section verified user uploads PDF handout
    asUser(videoUser, "verified");
    const fdVideo = new FormData();
    fdVideo.append("file", new File(["%PDF-1.4"], "Color_Grading.pdf", { type: "application/pdf" }));
    fdVideo.append("title", "Color Grading Guide");
    fdVideo.append("section", "video");

    const videoRes = await uploadResource(
      new NextRequest("http://localhost/api/resources", { method: "POST", body: fdVideo })
    );
    expect(videoRes.status).toBe(201);
    const videoItem = await videoRes.json();
    expect(videoItem.r2_key).toMatch(/^resources\/video\/.*Color_Grading\.pdf$/);

    // 3. Viewer can filter by section and download files
    asUser(viewer, "viewer");
    const listPhotoRes = await listResources(
      new NextRequest("http://localhost/api/resources?section=photo")
    );
    expect(listPhotoRes.status).toBe(200);
    const photoList = await listPhotoRes.json();
    expect(photoList).toHaveLength(1);
    expect(photoList[0].id).toBe(photoItem.id);

    // PPTX is forced as attachment with sandbox CSP
    const pptxDownload = await getResourceFileRoute(
      new NextRequest(`http://localhost/api/resources/${photoItem.id}/file`),
      { params: Promise.resolve({ id: String(photoItem.id) }) }
    );
    expect(pptxDownload.status).toBe(200);
    expect(pptxDownload.headers.get("Content-Disposition")).toContain("attachment;");
    expect(pptxDownload.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(pptxDownload.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // PDF opens inline by default and attachment with ?download=1
    const pdfView = await getResourceFileRoute(
      new NextRequest(`http://localhost/api/resources/${videoItem.id}/file`),
      { params: Promise.resolve({ id: String(videoItem.id) }) }
    );
    expect(pdfView.status).toBe(200);
    expect(pdfView.headers.get("Content-Disposition")).toContain("inline;");

    // 4. Ownership enforcement: videoUser cannot edit/delete photoUser's upload
    asUser(videoUser, "verified");
    const forbiddenPatch = await patchResource(
      new NextRequest(`http://localhost/api/resources/${photoItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hijacked" }),
      }),
      { params: Promise.resolve({ id: String(photoItem.id) }) }
    );
    expect(forbiddenPatch.status).toBe(403);

    const forbiddenDelete = await deleteResource(
      new NextRequest(`http://localhost/api/resources/${photoItem.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: String(photoItem.id) }) }
    );
    expect(forbiddenDelete.status).toBe(403);

    // photoUser can edit their own resource
    asUser(photoUser, "verified");
    const ownPatch = await patchResource(
      new NextRequest(`http://localhost/api/resources/${photoItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Framing & Composition v2", section: "av" }),
      }),
      { params: Promise.resolve({ id: String(photoItem.id) }) }
    );
    expect(ownPatch.status).toBe(200);
    const patched = await ownPatch.json();
    expect(patched.title).toBe("Framing & Composition v2");
    expect(patched.section).toBe("av");

    // 5. Admin can delete any resource and R2 object is cleaned up
    asUser(admin, "admin");
    const delRes = await deleteResource(
      new NextRequest(`http://localhost/api/resources/${photoItem.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: String(photoItem.id) }) }
    );
    expect(delRes.status).toBe(200);
    expect(store.has(photoItem.r2_key)).toBe(false);
    expect(store.has(videoItem.r2_key)).toBe(true);
  });
});

