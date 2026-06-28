import { redirect } from "next/navigation";
import { requireBartender } from "@/lib/auth";

// Wraps every page under /ppp/* (except /ppp/login) and enforces a bartender or
// admin session server-side. Full-screen, no sidebar — this is a POS surface.
export default async function PppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireBartender();

  if (!user) {
    redirect("/ppp/login");
  }

  return <div className="min-h-screen bg-gray-950 text-white">{children}</div>;
}
