"use client";

// Remembers a list page's data and scroll position for this browser tab
// (sessionStorage), so coming back to it — the browser's back button or a "← back"
// link — shows it as it was left instead of reloading from the top. Opening the
// page from the menu (SiteNav) clears it, which gives a fresh load.
// Storage can be unavailable (private mode, quota): every call fails soft.

interface ListCache<T> {
  data?: T;
  scrollY?: number;
}

const key = (path: string) => `list-cache:${path}`;

export function readListCache<T>(path: string): ListCache<T> | null {
  try {
    const raw = sessionStorage.getItem(key(path));
    return raw ? (JSON.parse(raw) as ListCache<T>) : null;
  } catch {
    return null;
  }
}

export function writeListCache<T>(path: string, patch: ListCache<T>) {
  try {
    sessionStorage.setItem(key(path), JSON.stringify({ ...readListCache<T>(path), ...patch }));
  } catch {
    // ignore — the page just loads fresh next time
  }
}

export function clearListCache(path: string) {
  try {
    sessionStorage.removeItem(key(path));
  } catch {
    // ignore
  }
}

// The menu item of the page you're already on: the app doesn't navigate, so the
// menu fires this event and the list page reloads itself (see SiteNav).
export const listReloadEvent = (path: string) => `list-reload:${path}`;
