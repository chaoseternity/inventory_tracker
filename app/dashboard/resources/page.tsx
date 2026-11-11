import { auth } from "@/lib/auth";
import { getAllResources, getUserByEmail } from "@/lib/db";
import { ResourceBankClient } from "@/components/ResourceBankClient";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Resource Bank | Inventory Tracker",
  description: "Session slides, handouts, and training materials for Photo, Video, and AV sections",
};

export default async function ResourceBankPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [resources, currentUser] = await Promise.all([
    getAllResources(),
    session.user?.email ? getUserByEmail(session.user.email) : Promise.resolve(undefined),
  ]);

  const currentUserId = currentUser?.id ?? (session.user?.id ? Number(session.user.id) : null);

  return (
    <ResourceBankClient
      initialResources={resources}
      role={currentUser?.role ?? session.user.role}
      currentUserId={Number.isInteger(currentUserId) ? currentUserId : null}
    />
  );
}

