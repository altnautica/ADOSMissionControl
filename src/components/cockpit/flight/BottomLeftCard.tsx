"use client";

/**
 * @module cockpit/flight/BottomLeftCard
 * @description The bottom-left card (cockpit spec `layout.json`
 * `bottom_left_card`): the map, the attitude radar or the obstacle radar,
 * switched by a horizontal swipe on the card or its page dots. On a compact
 * cockpit it is a small square chip showing the same face.
 *
 * @license GPL-3.0-only
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";

import { ProximityRadar } from "@/components/flight/ProximityRadar";
import { CockpitMinimap } from "../CockpitMinimap";
import { AttitudeRadar } from "./AttitudeRadar";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";

export const CARD_FACES = ["map", "attitude", "obstacles"] as const;
export type CardFace = (typeof CARD_FACES)[number];

/** Horizontal travel (px) that counts as a swipe. */
const SWIPE_PX = 40;

export function BottomLeftCard({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.card");
  const grid = useFlightGrid();
  const rect = grid.zones.bottom_left_card;
  const [face, setFace] = useState<CardFace>("map");
  const start = useRef<number | null>(null);
  if (!rect) return null;

  const step = (by: number) =>
    setFace((f) => CARD_FACES[(CARD_FACES.indexOf(f) + by + CARD_FACES.length) % CARD_FACES.length]);
  const onDown = (e: ReactPointerEvent) => {
    start.current = e.clientX;
  };
  const onUp = (e: ReactPointerEvent) => {
    const from = start.current;
    start.current = null;
    if (from === null) return;
    const dx = e.clientX - from;
    if (Math.abs(dx) >= SWIPE_PX) step(dx < 0 ? 1 : -1);
  };
  const size = Math.min(rect.w, rect.h);

  return (
    <div
      className="fs-panel fs-card"
      data-zone="bottom_left_card"
      data-face={face}
      data-chip={grid.cardIsChip ? "true" : "false"}
      style={rectStyle(rect)}
      onPointerDownCapture={onDown}
      onPointerUpCapture={onUp}
      aria-roledescription={t("roledescription")}
      aria-label={t(face)}
    >
      <div className="fs-card-face">
        {face === "map" && <CockpitMinimap droneId={droneId} />}
        {face === "attitude" && <AttitudeRadar droneId={droneId} size={size} />}
        {face === "obstacles" && (
          <div className="fs-card-radar">
            <ProximityRadar droneId={droneId} size={Math.max(64, size - 36)} />
          </div>
        )}
      </div>
      <div className="fs-dots" role="tablist" aria-label={t("switch")}>
        {CARD_FACES.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={face === f}
            aria-label={t(f)}
            data-testid={`fs-card-${f}`}
            onClick={() => setFace(f)}
          />
        ))}
      </div>
    </div>
  );
}
