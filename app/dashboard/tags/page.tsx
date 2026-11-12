import { auth } from "@/lib/auth";
import { getAllTags, getAllEquipment } from "@/lib/db";
import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/utils";
import { TagsManager } from "@/components/TagsManager";

export default async function TagsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!isAdminRole(session.user.role)) redirect("/dashboard");

  const [tags, equipment] = await Promise.all([
    getAllTags(),
    getAllEquipment(),
  ]);

  return (
    <TagsManager
      initialTags={tags}
      initialEquipment={equipment}
      role={session!.user.role}
    />
  );
}
