/**
 * Unit & route integration tests for SOP R2 object storage:
 * - lib/r2 helpers (key validation, put/get/delete, unbound fallback)
 * - POST /api/sop multipart uploads storing original binary in R2 (and skipping on 409/404)
 * - GET /api/sop/[id]/file auth, inline PDF vs forced attachment, nosniff headers
 * - Overwrite and DELETE /api/sop/[id] cleaning up old R2 objects
 */
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { auth } from "@/lib/auth";
import { upsertUser, createSOPDocument } from "@/lib/db";
import {
  setTestSopBucket,
  isValidSopObjectKey,
  buildSopObjectKey,
  putSopFile,
  getSopFile,
  deleteSopFile,
} from "@/lib/r2";
import { POST as uploadSop } from "@/app/api/sop/route";
import { DELETE as deleteSop } from "@/app/api/sop/[id]/route";
import { GET as getSopFileRoute } from "@/app/api/sop/[id]/file/route";
import { NextRequest } from "next/server";
import type { R2Bucket } from "@cloudflare/workers-types";

interface StoredEntry {
  bytes: Uint8Array;
  contentType: string;
}

function createMockR2Bucket() {
  const store = new Map<string, StoredEntry>();
  const bucket = {
    async put(key: string, value: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
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
        body: entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength),
      };
    },
    async delete(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) store.delete(k);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, store };
}

describe("SOP R2 object storage", () => {
  beforeEach(() => {
    setTestDb(makeTestDb());
    (auth as jest.Mock).mockResolvedValue(null);
    setTestSopBucket(null);
  });

  afterEach(() => {
    setTestDb(null);
    setTestSopBucket(undefined);
  });

  test("key validation rejects path traversal and invalid prefixes", () => {
    expect(isValidSopObjectKey("sop/123-abc-guide.pdf")).toBe(true);
    expect(isValidSopObjectKey("sop/../etc/passwd")).toBe(false);
    expect(isValidSopObjectKey("sop\\file.pdf")).toBe(false);
    expect(isValidSopObjectKey("other/file.pdf")).toBe(false);
    expect(isValidSopObjectKey("")).toBe(false);
    expect(isValidSopObjectKey(null)).toBe(false);

    const key = buildSopObjectKey("../../My Weird File (v1).pdf");
    expect(key.startsWith("sop/")).toBe(true);
    expect(key.endsWith("My_Weird_File__v1_.pdf")).toBe(true);
    expect(isValidSopObjectKey(key)).toBe(true);
  });

  test("r2 helpers gracefully no-op when SOP_BUCKET is unbound and round-trip when bound", async () => {
    setTestSopBucket(null);
    expect(await putSopFile(new Uint8Array([1, 2, 3]), "test.pdf", "application/pdf")).toBeNull();
    expect(await getSopFile("sop/missing.pdf")).toBeNull();
    await expect(deleteSopFile("sop/missing.pdf")).resolves.toBeUndefined();

    const { bucket, store } = createMockR2Bucket();
    setTestSopBucket(bucket);

    const data = new TextEncoder().encode("PDF-bytes");
    const key = await putSopFile(data, "manual.pdf", "application/pdf");
    expect(key).toBeTruthy();
    expect(store.size).toBe(1);

    const retrieved = await getSopFile(key);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.contentType).toBe("application/pdf");
    expect(retrieved?.size).toBe(data.byteLength);

    await deleteSopFile(key);
    expect(store.size).toBe(0);
  });

  test("POST /api/sop uploads multipart file to R2, saves r2_key, and GET /api/sop/[id]/file serves it", async () => {
    const admin = await upsertUser({
      name: "Admin R2",
      email: "admin.r2@school.edu",
      google_id: "g_r2",
      image: null,
      provider: "google",
      role: "admin",
    });
    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(admin.id), email: admin.email, name: admin.name, role: "admin" },
    });

    const { bucket, store } = createMockR2Bucket();
    setTestSopBucket(bucket);

    const fd = new FormData();
    const pdfBlob = new Blob(["%PDF-1.4 sample content"], { type: "application/pdf" });
    fd.append("file", new File([pdfBlob], "Camera_Guide.pdf", { type: "application/pdf" }));
    fd.append("title", "Camera Guide");
    fd.append("category", "Video");
    fd.append("content", "Always format SD cards in-camera.");

    const req = new NextRequest("http://localhost/api/sop", {
      method: "POST",
      body: fd,
    });
    const res = await uploadSop(req);
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.r2_key).toMatch(/^sop\/.*Camera_Guide\.pdf$/);
    expect(store.size).toBe(1);

    // Unauthenticated request to download is rejected with 401
    (auth as jest.Mock).mockResolvedValue(null);
    const unauthRes = await getSopFileRoute(
      new NextRequest(`http://localhost/api/sop/${created.id}/file`),
      { params: Promise.resolve({ id: String(created.id) }) }
    );
    expect(unauthRes.status).toBe(401);

    // Authenticated viewer can view PDF inline
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "99", email: "viewer@school.edu", name: "Viewer", role: "viewer" },
    });
    const inlineRes = await getSopFileRoute(
      new NextRequest(`http://localhost/api/sop/${created.id}/file`),
      { params: Promise.resolve({ id: String(created.id) }) }
    );
    expect(inlineRes.status).toBe(200);
    expect(inlineRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(inlineRes.headers.get("Content-Disposition")).toContain("inline;");
    expect(inlineRes.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // ?download=1 forces attachment
    const dlRes = await getSopFileRoute(
      new NextRequest(`http://localhost/api/sop/${created.id}/file?download=1`),
      { params: Promise.resolve({ id: String(created.id) }) }
    );
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers.get("Content-Disposition")).toContain("attachment;");
    expect(dlRes.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  test("non-PDF SOP files are forced as attachment (never inline) to prevent XSS", async () => {
    const member = await upsertUser({
      name: "Member",
      email: "member@school.edu",
      google_id: "g_mem",
      image: null,
      provider: "google",
      role: "verified",
    });
    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(member.id), email: member.email, name: member.name, role: "verified" },
    });

    const { bucket } = createMockR2Bucket();
    setTestSopBucket(bucket);

    const key = await putSopFile(new TextEncoder().encode("<svg onload=alert(1)>"), "notes.txt", "text/html");
    const doc = await createSOPDocument({
      title: "Text SOP",
      content: "Body text",
      file_name: "notes.txt",
      file_type: "text/html",
      r2_key: key,
      uploaded_by: member.id,
    });

    const res = await getSopFileRoute(
      new NextRequest(`http://localhost/api/sop/${doc.id}/file`),
      { params: Promise.resolve({ id: String(doc.id) }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment;");
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("duplicate 409 leaves R2 untouched; overwrite and DELETE clean up old R2 objects", async () => {
    const admin = await upsertUser({
      name: "Admin Cleanup",
      email: "admin.cleanup@school.edu",
      google_id: "g_clean",
      image: null,
      provider: "google",
      role: "admin",
    });
    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(admin.id), email: admin.email, name: admin.name, role: "admin" },
    });

    const { bucket, store } = createMockR2Bucket();
    setTestSopBucket(bucket);

    // 1. Initial upload
    const fd1 = new FormData();
    fd1.append("file", new File(["v1 content"], "Guide.txt", { type: "text/plain" }));
    fd1.append("title", "Audio Guide");
    fd1.append("content", "v1 content");
    const res1 = await uploadSop(new NextRequest("http://localhost/api/sop", { method: "POST", body: fd1 }));
    expect(res1.status).toBe(201);
    const doc1 = await res1.json();
    const oldKey = doc1.r2_key as string;
    expect(store.has(oldKey)).toBe(true);

    // 2. Duplicate without overwrite_id -> 409, no extra object stored in R2
    const fdDup = new FormData();
    fdDup.append("file", new File(["v2 content"], "Guide.txt", { type: "text/plain" }));
    fdDup.append("title", "Audio Guide");
    fdDup.append("content", "v2 content");
    const resDup = await uploadSop(new NextRequest("http://localhost/api/sop", { method: "POST", body: fdDup }));
    expect(resDup.status).toBe(409);
    expect(store.size).toBe(1);
    expect(store.has(oldKey)).toBe(true);

    // 3. Overwrite with overwrite_id -> stores new object and deletes oldKey
    const fdOverwrite = new FormData();
    fdOverwrite.append("file", new File(["v2 content"], "Guide.txt", { type: "text/plain" }));
    fdOverwrite.append("title", "Audio Guide");
    fdOverwrite.append("content", "v2 content");
    fdOverwrite.append("overwrite_id", String(doc1.id));
    const resOverwrite = await uploadSop(
      new NextRequest("http://localhost/api/sop", { method: "POST", body: fdOverwrite })
    );
    expect(resOverwrite.status).toBe(200);
    const updated = await resOverwrite.json();
    const newKey = updated.r2_key as string;
    expect(newKey).not.toBe(oldKey);
    expect(store.has(oldKey)).toBe(false);
    expect(store.has(newKey)).toBe(true);
    expect(store.size).toBe(1);

    // 4. DELETE removes DB row and R2 object
    const delRes = await deleteSop(
      new NextRequest(`http://localhost/api/sop/${doc1.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: String(doc1.id) }) }
    );
    expect(delRes.status).toBe(200);
    expect(store.size).toBe(0);
  });
});

