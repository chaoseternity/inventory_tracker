import { auth } from "@/lib/auth";
import { getActiveAuditSession, getAuditSessionDetails, getAllEquipment } from "@/lib/db";
import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/utils";
import { AuditClient } from "./AuditClient";

export default async function AuditPage() {
  const session = await auth();
  if (!session) redirect("/login");

  if (!isAdminRole(session.user.role)) {
    redirect("/dashboard");
  }

  const [activeSession, equipment] = await Promise.all([
    getActiveAuditSession(),
    getAllEquipment(),
  ]);

  let fullSession = activeSession;
  if (activeSession) {
    const details = await getAuditSessionDetails(activeSession.id);
    if (details) {
      fullSession = {
        ...activeSession,
        ...details,
      };
    }
  }

  return (
    <AuditClient
      initialSession={fullSession}
      equipmentList={equipment}
      role={session.user.role}
      userName={session.user.name ?? ""}
    />
  );
}
