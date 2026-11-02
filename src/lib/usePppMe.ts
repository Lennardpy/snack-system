"use client";

import { useEffect, useState } from "react";
import type { AssociationId } from "./associations";

export interface PppMe {
  memberId: string | null;
  role: "ADMIN" | "BARTENDER";
  associationId: AssociationId | null; // null = every association
  overall: boolean; // the overall admin
}

// The signed-in PPP user (GET /api/ppp/me); null while loading.
export function usePppMe(): PppMe | null {
  const [me, setMe] = useState<PppMe | null>(null);
  useEffect(() => {
    fetch("/api/ppp/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);
  return me;
}
