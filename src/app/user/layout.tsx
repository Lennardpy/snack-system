import type { Metadata } from "next";

export const metadata: Metadata = { title: "My bar tab — PPP" };

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return children;
}
