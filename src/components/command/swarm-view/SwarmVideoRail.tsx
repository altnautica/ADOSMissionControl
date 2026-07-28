"use client";

/**
 * @module command/swarm-view/SwarmVideoRail
 * @description Band five, and deliberately the smallest: this is a state board
 * first and a video wall second.
 *
 * The hero pane is `VideoFeedCard`, unchanged — the same singleton WebRTC
 * surface the Fly view drives. The rail does NOT open a second per-drone video
 * budget. The round-robin one already exists on the fleet grid and is governed
 * by Pin, and standing up a competing set of sessions here would make Hero and
 * Pin fight over the same scarce thing while pretending to be independent
 * primitives. So the strip below carries each slot's chrome and its controls,
 * and the aircraft the operator is connected to carries the picture.
 *
 * Hero is not Pin. Pin is personal, multi-select and costs no airtime; Hero is
 * exclusive and re-allocates the radio, demoting the previous holder to 1 fps.
 * They get separate verbs, separate icons and separate handlers — and what the
 * strip lights up is the beacon's own hero bit, so a demotion that failed reads
 * as two lit crosshairs rather than as an assumption.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Crosshair, Expand, Video } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { formatCommandAge } from "@/hooks/use-command-agent-fleet";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { StatusDot } from "@/components/ui/status-dot";
import { VideoFeedCard } from "@/components/command/shared/VideoFeedCard";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import {
  SWARM_SEVERITY_LEVEL,
  SWARM_SEVERITY_SHAPE,
  swarmRowDeviceId,
  swarmRowName,
  type SwarmSlotRow,
} from "./swarm-rows";
import { useSwarmSlotRows } from "./use-swarm-slot-rows";
import { useFleetHero } from "./use-fleet-hero";

export interface SwarmVideoRailProps {
  rows: readonly SwarmBeaconRow[];
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>;
  onOpenAgent: (deviceId: string) => void;
}

export function SwarmVideoRail({
  rows,
  nodesBySlot,
  onOpenAgent,
}: SwarmVideoRailProps) {
  const t = useTranslations("swarmView.video");
  const tHero = useTranslations("swarmView.hero");
  const connectedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const hero = useFleetHero();

  const slotRows = useSwarmSlotRows(rows, nodesBySlot);
  const heroRow = useMemo(
    () => slotRows.find((row) => row.beacon?.hero) ?? null,
    [slotRows],
  );
  const heroDeviceId = heroRow ? swarmRowDeviceId(heroRow) : null;
  const showingHero = heroDeviceId !== null && heroDeviceId === connectedDeviceId;

  return (
    <section className="mt-3 rounded-lg border border-border-default bg-bg-secondary">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <Video size={13} className="text-text-tertiary" />
          {t("title")}
        </div>
        <span className="text-[11px] text-text-tertiary">
          {heroRow
            ? t("heroIs", {
                name: swarmRowName(heroRow, `#${heroRow.slot}`),
                slot: heroRow.slot,
              })
            : t("noHero")}
        </span>
        {heroRow && !showingHero && heroDeviceId && (
          // The pane below shows whichever drone this browser is connected to.
          // Saying so — and offering the switch — is the honest alternative to
          // labelling someone else's picture "hero".
          <button
            type="button"
            onClick={() => onOpenAgent(heroDeviceId)}
            className="flex items-center gap-1 rounded border border-border-default bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <Expand size={11} />
            {t("connectToHero")}
          </button>
        )}
      </div>

      <div className="p-3">
        {/* Height-clamped on purpose. `VideoFeedCard` is built to fill a pane
            of its own, and unbounded it makes this band the tallest thing on a
            board whose job is the rows above it. This is a state board first
            and a video wall second, so the picture gets a rail's worth of room
            and no more. The clamp is a wrapper rather than a prop so the card
            itself is reused exactly as the Fly view uses it. */}
        <div className="h-[300px] overflow-hidden rounded border border-border-default">
          <VideoFeedCard className="h-full" />
        </div>
        {!showingHero && (
          <p className="mt-1 text-[10px] text-text-tertiary">
            {heroRow ? t("showingConnected") : t("pickHeroHint")}
          </p>
        )}

        {slotRows.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {slotRows.map((row) => (
              <SwarmThumbnailTile
                key={row.slot}
                row={row}
                pending={
                  hero.pendingDeviceId !== null &&
                  hero.pendingDeviceId === swarmRowDeviceId(row)
                }
                heroUnavailable={hero.unavailable}
                onMakeHero={hero.makeHero}
                onOpenAgent={onOpenAgent}
                makeLabel={tHero("make")}
                currentLabel={tHero("current")}
                unavailableLabel={tHero("unavailable")}
                openLabel={t("open")}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * One slot's tile. The chrome is the fleet grid's — same rounded card, same
 * liveness dot, same `opacity-0 group-hover:opacity-100` action reveal — so the
 * Make Hero control feels native to a surface the operator already knows. What
 * it is NOT is a pin: different icon, different verb, different handler.
 */
function SwarmThumbnailTile({
  row,
  pending,
  heroUnavailable,
  onMakeHero,
  onOpenAgent,
  makeLabel,
  currentLabel,
  unavailableLabel,
  openLabel,
}: {
  row: SwarmSlotRow;
  pending: boolean;
  heroUnavailable: boolean;
  onMakeHero: (deviceId: string) => void;
  onOpenAgent: (deviceId: string) => void;
  makeLabel: string;
  currentLabel: string;
  unavailableLabel: string;
  openLabel: string;
}) {
  const deviceId = swarmRowDeviceId(row);
  const isHero = row.beacon?.hero ?? false;
  const name = swarmRowName(row, `#${row.slot}`);

  return (
    <article
      className={cn(
        "group relative w-[170px] shrink-0 overflow-hidden rounded-lg border bg-bg-primary transition-colors",
        isHero
          ? "border-accent-primary"
          : "border-border-default hover:border-accent-primary/50",
        row.beacon ? "" : "opacity-60",
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <StatusDot
          status={SWARM_SEVERITY_LEVEL[row.severity]}
          shape={SWARM_SEVERITY_SHAPE[row.severity]}
          size="xs"
          label={name}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] text-text-primary">
          {name}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
          {row.slot}
        </span>
      </div>

      <div className="flex items-center justify-between border-t border-border-default px-2 py-1">
        <span className="font-mono text-[10px] text-text-tertiary">
          {formatCommandAge(row.summary?.lastSeen ?? null)}
        </span>

        <div className="flex gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => deviceId && onMakeHero(deviceId)}
            disabled={isHero || pending || heroUnavailable || deviceId === null}
            aria-pressed={isHero}
            title={
              isHero
                ? currentLabel
                : heroUnavailable || deviceId === null
                  ? unavailableLabel
                  : makeLabel
            }
            className={cn(
              "rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
              isHero
                ? "bg-accent-primary/20 text-accent-primary"
                : "bg-black/55 text-text-secondary hover:text-text-primary disabled:opacity-40",
            )}
          >
            <Crosshair size={12} className={pending ? "animate-pulse" : undefined} />
            <span className="sr-only">{isHero ? currentLabel : makeLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => deviceId && onOpenAgent(deviceId)}
            disabled={deviceId === null}
            title={openLabel}
            className="rounded bg-accent-primary p-1 text-bg-primary hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <Expand size={12} />
            <span className="sr-only">{openLabel}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
