// Read-only sync with Alexia (Inter-Actief's drink-scheduling system at
// alex.ia.utwente.nl). The bar committee books borrels there; we surface the
// upcoming ones in the PPP activity selector so a bartender can open them with
// one tap instead of typing the name.
//
// The `event.upcoming_list` JSON-RPC method is PUBLIC (no auth), so we just POST
// to it server-side. Everything here fails soft: any error → no Alexia events,
// PPP keeps working.

import type { AssociationId } from "./associations";

const ALEXIA_URL = process.env.ALEXIA_API_URL ?? "https://alex.ia.utwente.nl/api/1/";
// Only borrels organised by Stress or Dimensie are imported; the organiser decides
// which association hosts (and pays for) the borrel. Override if a label changes.
const ORGANIZERS: Record<string, AssociationId> = {
  [process.env.ALEXIA_ORGANIZER ?? "Stress"]: "stress",
  [process.env.ALEXIA_ORGANIZER_DIMENSIE ?? "Dimensie"]: "dimensie",
};

// The weekly joint drink: a Stress "Weekly Drink" on a Thursday (Amsterdam time).
// Stress hosts and pays; members of both associations can pay there.
export function isJointBorrel(associationId: AssociationId, name: string, startsAt: Date): boolean {
  if (associationId !== "stress" || !/weekly/i.test(name)) return false;
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/Amsterdam" }).format(startsAt);
  return weekday === "Thu";
}

interface AlexiaRawEvent {
  name: string;
  organizer: string;
  locations: string[];
  starts_at: string;
  ends_at: string;
}

export interface AlexiaEvent {
  associationId: AssociationId; // the organiser
  name: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  locations: string[];
}

// Fetch upcoming (+ ongoing) borrels of Stress and Dimensie, soonest first.
export async function fetchAlexiaEvents(): Promise<AlexiaEvent[]> {
  try {
    const res = await fetch(ALEXIA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "event.upcoming_list",
        params: [true], // include_ongoing
        id: 1,
      }),
      // Don't let a slow third party hang the page.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { result?: AlexiaRawEvent[] };
    const events = body.result ?? [];
    return events
      .filter((e) => e.organizer in ORGANIZERS)
      .map((e) => ({
        associationId: ORGANIZERS[e.organizer],
        name: e.name,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        locations: e.locations ?? [],
      }))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  } catch {
    return [];
  }
}

// Alexia events have no stable id, so an imported borrel is matched to a PPP
// activity by name + calendar day.
export function alexiaMatchKey(name: string, isoDate: string): string {
  return `${name.trim().toLowerCase()}|${isoDate.slice(0, 10)}`;
}
