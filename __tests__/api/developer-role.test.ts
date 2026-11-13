/**
 * Tests verifying the 'developer' role has identical permissions and safeguards to 'admin'.
 */
import { makeTestDb, setTestDb } from "@/lib/test-db";

jest.mock("@/lib/auth", () => ({
  auth: jest.fn().mockResolvedValue(null),
}));

import { auth } from "@/lib/auth";
import {
  upsertUser,
  updateUserRole,
  deleteUser,
  countAdmins,
  ConfiguredDeveloperError,
  isConfiguredDeveloperEmail,
  getDeveloperEmails,
} from "@/lib/db";
import { isAdminRole, isVerifiedOrHigher, roleBadgeClass, ASSIGNABLE_ROLES } from "@/lib/utils";
import { POST as createEquipmentRoute } from "@/app/api/equipment/route";
import { GET as listUsersRoute } from "@/app/api/users/route";
import { PUT as updateUserRoute } from "@/app/api/users/[id]/route";
import { POST as createTagRoute } from "@/app/api/tags/route";
import { POST as createEventRoute, GET as listEventsRoute } from "@/app/api/events/route";
import { GET as listReservationsRoute } from "@/app/api/reservations/route";
import { GET as getStorageMapRoute } from "@/app/api/storage-map/route";
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
    delete process.env.DEVELOPER_EMAILS;
    setTestDb(null);
  });

  test("role helpers and badge styling support developer", () => {
    expect(isAdminRole("developer")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("verified")).toBe(false);
    expect(isAdminRole("viewer")).toBe(false);

    expect(isVerifiedOrHigher("developer")).toBe(true);
    expect(roleBadgeClass.developer).toBeTruthy();
    expect(ASSIGNABLE_ROLES).not.toContain("developer");
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "verified", "viewer"]);
  });

  test("DB supports developer role, counts it as admin-level, and protects sole remaining developer/admin", async () => {
    process.env.DEVELOPER_EMAILS = "dev@school.edu";
    const dev = await upsertUser({
      name: "Dev User",
      email: "dev@school.edu",
      google_id: "g_dev",
      image: null,
      provider: "google",
    });
    expect(dev.role).toBe("developer");
    expect(await countAdmins()).toBe(1);

    // Configured developer cannot be demoted or deleted via DB functions
    await expect(updateUserRole(dev.id, "viewer")).rejects.toBeInstanceOf(ConfiguredDeveloperError);
    const delRes = await deleteUser(dev.id);
    expect(delRes.success).toBe(false);

    // Adding an admin
    const admin = await upsertUser({
      name: "Admin User",
      email: "admin@school.edu",
      google_id: "g_admin",
      image: null,
      provider: "google",
      role: "admin",
    });
    expect(await countAdmins()).toBe(2);

    // Attempting to assign developer role via updateUserRole fails
    const promoteRes = await updateUserRole(admin.id, "developer");
    expect(promoteRes.success).toBe(false);
    expect(promoteRes.error).toMatch(/cannot be assigned via the website/i);
    expect(await countAdmins()).toBe(2);
  });

  test("users in developers.json automatically receive developer role and cannot be modified via website", async () => {
    // 1. developers.json has zhangbohan0429@gmail.com
    expect(isConfiguredDeveloperEmail("zhangbohan0429@gmail.com")).toBe(true);
    expect(getDeveloperEmails().has("zhangbohan0429@gmail.com")).toBe(true);

    const devUser = await upsertUser({
      name: "Main Developer",
      email: "zhangbohan0429@gmail.com",
      google_id: "g_maindev",
      image: null,
      provider: "google",
    });
    expect(devUser.role).toBe("developer");

    // 2. An admin or developer trying to modify their role via PUT /api/users/[id] is blocked (403)
    (auth as jest.Mock).mockResolvedValue({
      user: { id: "999", email: "otherdev@school.edu", name: "Other Dev", role: "developer" },
    });

    const updateAttempt = await updateUserRoute(
      jsonReq(`/api/users/${devUser.id}`, "PUT", { role: "viewer" }),
      { params: Promise.resolve({ id: String(devUser.id) }) }
    );
    expect(updateAttempt.status).toBe(403);
    const errBody = await updateAttempt.json();
    expect(errBody.error).toMatch(/developers\.json/i);

    // 3. Trying to assign developer role to a regular user via PUT /api/users/[id] is blocked (400 validation error)
    const viewer = await upsertUser({
      name: "Basic Viewer",
      email: "viewer@school.edu",
      google_id: "g_v",
      image: null,
      provider: "google",
      role: "viewer",
    });

    const assignDevAttempt = await updateUserRoute(
      jsonReq(`/api/users/${viewer.id}`, "PUT", { role: "developer" }),
      { params: Promise.resolve({ id: String(viewer.id) }) }
    );
    expect(assignDevAttempt.status).toBe(400);
  });

  test("developer can access all admin-only API routes", async () => {
    process.env.DEVELOPER_EMAILS = "lead.dev@school.edu";
    const dev = await upsertUser({
      name: "Lead Dev",
      email: "lead.dev@school.edu",
      google_id: "g_ldev",
      image: null,
      provider: "google",
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

    // 2. Full user directory + update user role to admin (developer role rejected by schema)
    const usersRes = await listUsersRoute();
    expect(usersRes.status).toBe(200);
    const usersList = await usersRes.json();
    expect(usersList[0]).toHaveProperty("email");

    const failDevRes = await updateUserRoute(
      jsonReq(`/api/users/${viewer.id}`, "PUT", { role: "developer" }),
      { params: Promise.resolve({ id: String(viewer.id) }) }
    );
    expect(failDevRes.status).toBe(400);

    const roleUpdateRes = await updateUserRoute(
      jsonReq(`/api/users/${viewer.id}`, "PUT", { role: "admin" }),
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

  test("reservations, events, and storage-map are restricted exclusively to developer role", async () => {
    for (const role of ["admin", "verified", "viewer"] as const) {
      (auth as jest.Mock).mockResolvedValue({
        user: { id: "99", email: `${role}@school.edu`, name: role, role },
      });
      expect((await listReservationsRoute(new NextRequest("http://localhost/api/reservations"))).status).toBe(403);
      expect((await listEventsRoute()).status).toBe(403);
      expect((await getStorageMapRoute()).status).toBe(403);
    }

    (auth as jest.Mock).mockResolvedValue({
      user: { id: "1", email: "dev@school.edu", name: "Dev", role: "developer" },
    });
    expect((await listReservationsRoute(new NextRequest("http://localhost/api/reservations"))).status).toBe(200);
    expect((await listEventsRoute()).status).toBe(200);
    expect((await getStorageMapRoute()).status).toBe(200);
  });
});

