import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getIssueMapPoints } from "@/lib/issues/map";
import CommunityMapPanel from "@/components/map/community-map-panel";

export const metadata = {
  title: "Community Issue Map — Nexa",
};

export default async function MapPage() {
  const session = await getSession();
  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent("/map")}`);
  }

  const points = await getIssueMapPoints(session.userId);

  return (
    <main className="flex-1">
      <CommunityMapPanel initialPoints={points} />
    </main>
  );
}
