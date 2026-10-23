// Two sites served by one app, told apart by the domain:
//   • SSS — the snack system (kiosk + SSS admin), snacks.51vo.nl
//   • PPP — the bar system (POS + PPP admin, Stress and Dimensie), ppp.51vo.nl
// Each has its own login: the session cookie is per domain and a session is only
// valid on the site it was created on. Safe for middleware (edge) and server code.
//
// Origins come from SSS_ORIGIN / PPP_ORIGIN (staging sets its own). Locally,
// localhost:3000 is SSS and ppp.localhost:3000 is PPP (browsers resolve
// *.localhost to this machine).

export type Site = "sss" | "ppp";

const DEFAULT_ORIGIN: Record<Site, string> = {
  sss: "https://snacks.51vo.nl",
  ppp: "https://ppp.51vo.nl",
};

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return "";
  }
};

// Local dev only: in production the sites are told apart by their configured origins.
const isLocal = (host: string) =>
  process.env.NODE_ENV !== "production" && (/(^|\.)localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host));

export function siteForHost(rawHost: string | null | undefined): Site {
  const host = (rawHost ?? "").toLowerCase();
  const pppHost = hostOf(process.env.PPP_ORIGIN ?? DEFAULT_ORIGIN.ppp);
  if (host === pppHost || host === `www.${pppHost}`) return "ppp";
  if (isLocal(host) && host.startsWith("ppp.")) return "ppp";
  return "sss";
}

// The origin of a site, as seen from a request to `currentHost` (so local dev
// links stay on localhost with the same port). Note: in local dev a middleware
// redirect from ppp.localhost to localhost gets made relative by Next (its
// internal request URL is localhost:<port>), so open the SSS at localhost directly.
export function siteOrigin(site: Site, currentHost?: string | null): string {
  const host = (currentHost ?? "").toLowerCase();
  if (host && isLocal(host)) {
    const bare = host.replace(/^ppp\./, "");
    return `http://${site === "ppp" ? `ppp.${bare}` : bare}`;
  }
  const env = site === "ppp" ? process.env.PPP_ORIGIN : process.env.SSS_ORIGIN ?? process.env.BASE_URL;
  return (env ?? DEFAULT_ORIGIN[site]).replace(/\/$/, "");
}

export const SITE_NAME: Record<Site, string> = {
  sss: "SSS — Stress Snack System",
  ppp: "PPP — bar system",
};
