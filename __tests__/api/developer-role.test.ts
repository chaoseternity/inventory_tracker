/**
 * Tests verifying the 'developer' role has identical permissions and safeguards to 'admin'.
 */
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { auth } from "@/lib/auth";
import { upsertUser, updateUserRole, deleteUser, countAdmins } from "@/lib/db";
import { isAdminRole, isVerifiedOrHigher, roleBadgeClass } from "@/lib/utils";
import { POST as createEquipmentRoute } from "@/app/api/equipment/route";
import { GET as listUsersRoute } from "@/app/api/users/route";
import { PUT as updateUserRoute } from "@/app/api/users/[id]/route";
import { POST as createTagRoute } from "@/app/api/tags/route";
import { POST as createEventRoute } from "@/app/api/events/route";
import { POST as auditSessionPost } from "@/app/api/audit/session/route";
import { NextRequest } from "next/server";

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("developer role parity with admin", () => {
  beforeEach(() => {
    setTestDb(makeTestDb());
    (auth as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    setTestDb(null);
  });

  test("role helpers and badge styling support developer", () => {
    expect(isAdminRole("developer")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("verified")).toBe(false);
    expect(isAdminRole("viewer")).toBe(false);

    expect(isVerifiedOrHigher("developer")).toBe(true);
    expect(roleBadgeClass.developer).toBeTruthy();
  });

  test("DB supports developer role, counts it as admin-level, and protects sole remaining developer/admin", async () => {
    const dev = await upsertUser({
      name: "Dev User",
      email: "dev@school.edu",
      google_id: "g_dev",
      image: null,
      provider: "google",
      role: "developer",
    });
    expect(dev.role).toBe("developer");
    expect(await countAdmins()).toBe(1);

    // Cannot demote or delete the only remaining admin-level account
    const demoteRes = await updateUserRole(dev.id, "viewer");
    expect(demoteRes.success).toBe(false);
    const delRes = await deleteUser(dev.id);
    expect(delRes.success).toBe(false);

    // Adding an admin allows demoting/promoting between developer and admin
    const admin = await upsertUser({
      name: "Admin User",
      email: "admin@school.edu",
      google_id: "g_admin",
      image: null,
      provider: "google",
      role: "admin",
    });
    expect(await countAdmins()).toBe(2);

    const promoteRes = await updateUserRole(admin.id, "developer");
    expect(promoteRes.success).toBe(true);
    expect(await countAdmins()).toBe(2);
  });

  test("developer can access all admin-only API routes", async () => {
    const dev = await upsertUser({
      name: "Lead Dev",
      email: "lead.dev@school.edu",
      google_id: "g_ldev",
      image: null,
      provider: "google",
      role: "developer",
    });
    const viewer = await upsertUser({
      name: "Basic Viewer",
      email: "viewer@school.edu",
      google_id: "g_v",
      image: null,
      provider: "google",
      role: "viewer",
    });

    (auth as jest.Mock).mockResolvedValue({
      user: { id: String(dev.id), email: dev.email, name: dev.name, role: "developer" },
    });

    // 1. Create equipment
    const eqRes = await createEquipmentRoute(
      jsonReq("/api/equipment", "POST", {
        name: "Sony A7S III",
        tags: ["Camera"],
        location: "Media Room",
      })
    );
    expect(eqRes.status).toBe(201);

    // 2. Full user directory + update user role to developer
    const usersRes = await listUsersRoute();
    expect(usersRes.status).toBe(200);
    const usersList = await usersRes.json();
    expect(usersList[0]).toHaveProperty("email");

    const roleUpdateRes = await updateUserRoute(
      jsonReq(`/api/users/${viewer.id}`, "PUT", { role: "developer" }),
      { params: Promise.resolve({ id: String(viewer.id) }) }
    );
    expect(roleUpdateRes.status).toBe(200);

    // 3. Create tag
    const tagRes = await createTagRoute(jsonReq("/api/tags", "POST", { name: "Lighting" }));
    expect(tagRes.status).toBe(201);

    // 4. Create event
    const eventRes = await createEventRoute(
      jsonReq("/api/events", "POST", {
        name: "Open House",
        start_time: "2026-12-01T09:00:00Z",
        end_time: "2026-12-01T12:00:00Z",
        location: "Auditorium",
      })
    );
    expect(eventRes.status).toBe(201);

    // 5. Start audit session
    const auditRes = await auditSessionPost(jsonReq("/api/audit/session", "POST", { name: "Dev Audit" }));
    expect(auditRes.status).toBe(201);
  });
});

