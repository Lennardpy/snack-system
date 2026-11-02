// A "?from=" path to return to after signing in: only a path on this site
// ("/admin/…"), never another origin ("https://…", "//evil.example", "/\\evil").
export function safeReturnPath(from: string | null): string | null {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return null;
  return from;
}
