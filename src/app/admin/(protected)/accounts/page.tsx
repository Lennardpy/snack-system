import { redirect } from "next/navigation";
import { requireOverallAdmin } from "@/lib/auth";
import AccountsView from "@/components/AccountsView";

// Admin logins — overall admin only.
export default async function AccountsPage() {
  if (!(await requireOverallAdmin())) redirect("/");
  return <AccountsView />;
}
