"use client";

/**
 * @module cockpit/flight/BottomLeftCard
 * @description The bottom-left card (cockpit spec `layout.json`
 * `bottom_left_card`): the map, the attitude radar or the obstacle radar,
 * switched by a horizontal swipe on the card or its page dots (the spec's
 * `switch`), never by arrows. Each face carries its own small title inside
 * the card. The map's own controls (frame toggle, zoom, scale) belong to the
 * map face and leave with it. On a compact cockpit it is a small square chip
 * showing the same face.
 *
 * @license GPL-3.0-only
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { specString } from "@/lib/cockpit/spec-strings";
import { ProximityRadar } from "@/components/flight/ProximityRadar";
import { CockpitMinimap } from "../CockpitMinimap";
import { AttitudeRadar } from "./AttitudeRadar";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";

export type CardFace = "map" | "attitude_radar" | "obstacle_radar";

const KNOWN_FACES: readonly CardFace[] = ["map", "attitude_radar", "obstacle_radar"];
const cardZone = layoutSpec.zones.find((z) => z.id === "bottom_left_card") as { cards?: string[] } | undefined;

/** The card's faces in the spec's order. */
export const CARD_FACES: readonly CardFace[] = (cardZone?.cards ?? KNOWN_FACES).filter((f): f is CardFace =>
  (KNOWN_FACES as readonly string[]).includes(f),
);

/** A face's title, from the shared strings (`cockpit.card.<face>`). */
export function cardFaceTitle(face: CardFace): string {
  return specString(`cockpit.card.${face}`);
}

/** Horizontal travel (px) that counts as a swipe. */
const SWIPE_PX = 40;

export function BottomLeftCard({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.card");
  const grid = useFlightGrid();
  const rect = grid.zones.bottom_left_card;
  const [face, setFace] = useState<CardFace>(CARD_FACES[0] ?? "map");
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
  const title = cardFaceTitle(face);

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
      aria-label={title}
    >
      <div className="fs-card-face" data-testid={`fs-card-face-${face}`}>
        {face === "map" && <CockpitMinimap droneId={droneId} />}
        {face === "attitude_radar" && <AttitudeRadar droneId={droneId} size={size} />}
        {face === "obstacle_radar" && (
          <div className="fs-card-radar">
            <ProximityRadar droneId={droneId} size={Math.max(64, size - 36)} />
          </div>
        )}
      </div>
      <span className="fs-card-title" data-testid="fs-card-title" aria-hidden="true">
        {title}
      </span>
      <div className="fs-dots" role="tablist" aria-label={t("switch")}>
        {CARD_FACES.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={face === f}
            aria-label={cardFaceTitle(f)}
            data-testid={`fs-card-${f}`}
            onClick={() => setFace(f)}
          />
        ))}
      </div>
    </div>
  );
}
