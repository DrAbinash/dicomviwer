import { redirect } from "next/navigation";
import ViewerRoot from "@/components/viewer-root";
import { getSessionUser } from "@/lib/server/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <ViewerRoot />;
}
