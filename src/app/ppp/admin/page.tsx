import { redirect } from "next/navigation";

// /ppp/admin → the PPP dashboard (the layout of that page checks the login).
export default function PppAdminIndex() {
  redirect("/ppp/admin/dashboard");
}
