import type { Metadata } from "next";
import Board from "./Board";

// PUBLIC — the Wall Street board for a screen at the bar.
export const metadata: Metadata = {
  title: "Wall Street — Stress",
  description: "Live drink prices at the Stress borrel",
};

export default function WallStreetPage() {
  return <Board />;
}
