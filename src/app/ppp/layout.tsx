import type { Metadata, Viewport } from "next";

// Wraps ALL of /ppp/* (login + the protected POS). Its only job is to attach the
// installable PWA manifest so Android's "Add to Home Screen" launches the POS
// FULL-SCREEN with no browser chrome (display: fullscreen in ppp.webmanifest).
//
// Scoped to /ppp: the manifest's start_url/scope are the bar POS, so the home
// screen icon opens straight into it — and the SSS snack kiosk is untouched.
export const metadata: Metadata = {
  title: "PPP Bar POS",
  manifest: "/ppp.webmanifest",
  appleWebApp: {
    // iOS ignores the manifest but honours these for an added-to-home shortcut.
    capable: true,
    title: "PPP",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#030712", // gray-950 — matches the POS background
  viewportFit: "cover", // fill the whole screen, including any notch/rounded area
};

export default function PppSegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
