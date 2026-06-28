import { cookies } from "next/headers";
import { prisma } from "./prisma";

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session || session.user.role !== "ADMIN") return null;
  return session.user;
}

// PPP routes: bartenders operate the bar POS; admins can do everything a
// bartender can. Returns the user, or null if not signed in with a sufficient role.
export async function requireBartender() {
  const session = await getSession();
  if (!session) return null;
  const { role } = session.user;
  if (role !== "ADMIN" && role !== "BARTENDER") return null;
  return session.user;
}
