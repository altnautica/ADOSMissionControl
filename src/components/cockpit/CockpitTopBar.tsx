/**
 * The cockpit SAFETY BAND. Left to right: exit control, node name + reach
 * badge, arm state, flight mode, battery, GPS, link, video, stick control,
 * pre-flight, REC, flight timer, and Kill. Styling lives in
 * `.ados-cockpit .safety`; this component only composes cells.
 *
 * The band is ALWAYS on: safety-critical status is never hideable. The
 * operator's "top bar" chrome toggle only drops the decorative wordmark via
 * {@link CockpitTopBarProps.lean}. Values never wrap. As the cockpit narrows
 * (container queries in the cockpit styles) text labels give way to icons,
 * then the secondary cells (stick, pre-flight, REC, flight time) move behind
 * a "more" toggle; exit, reach, arm, mode, battery, GPS, link, video and Kill
 * stay on the band at every width.
 *
 * Every cell subscribes to its own source, so a telemetry tick re-renders
 * the vehicle-state cells, a clock tick the timers, and nothing re-renders
 * the cockpit around the band.
 *
 * @module cockpit/CockpitTopBar
 * @license GPL-3.0-only
 */

"use client";

import { memo, useState } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { BandFlightStats } from "./band/BandFlightStats";
import { BandVideoStat } from "./band/BandVideoStat";
import {
  BandExitControl,
  BandFlightTimer,
  BandKillButton,
  BandRecControl,
} from "./band/BandControls";
import { useBandReach, type BandReach } from "./band/use-band-reach";
import { StickControlChip } from "./StickControlChip";
import { PreflightChip } from "./PreflightChip";

const REACH_KEY: Record<BandReach, "reachDirect" | "reachLan" | "reachRelayed" | "reachCloud"> = {
  direct: "reachDirect",
  lan: "reachLan",
  relayed: "reachRelayed",
  cloud: "reachCloud",
};

export interface CockpitTopBarProps {
  /** The drone this cockpit flies. */
  droneId: string;
  /** Drop the decorative wordmark for a clean safety-only strip. */
  lean: boolean;
}

function NodeLabel({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpit");
  const displayName = useDroneMetadataStore((s) => s.profiles[droneId]?.displayName);
  // A direct-connect session has no stored profile; its managed name is the
  // label, never the bare session id when a name exists.
  const sessionName = useDroneManager((s) => s.drones.get(droneId)?.name);
  const reach = useBandReach(droneId);
  return (
    <>
      <span className="node" data-testid="cockpit-node-name">
        {displayName ?? sessionName ?? droneId}
      </span>
      {reach && (
        <span
          className="ml-2 shrink-0 whitespace-nowrap rounded px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em]"
          style={{ color: "var(--hud-ink-2)", border: "1px solid var(--hud-hair)" }}
          data-testid="cockpit-reach"
          data-reach={reach}
        >
          {t(`band.${REACH_KEY[reach]}`)}
        </span>
      )}
    </>
  );
}

function CockpitTopBarInner({ droneId, lean }: CockpitTopBarProps) {
  const t = useTranslations("cockpit.band");
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <div className="safety" data-more={moreOpen ? "true" : "false"}>
      <BandExitControl />
      {!lean && <span className="brand">ADOS</span>}
      <NodeLabel droneId={droneId} />
      <span className="spacer" />
      <BandFlightStats droneId={droneId} />
      <BandVideoStat droneId={droneId} />
      <div id="cockpit-band-secondary" className="band-sec">
        <StickControlChip droneId={droneId} />
        <PreflightChip droneId={droneId} />
        <BandRecControl droneId={droneId} />
        <BandFlightTimer />
      </div>
      <div className="stat band-more">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="cockpit-band-secondary"
          aria-label={t("more")}
          title={t("more")}
          className="pointer-events-auto flex items-center transition-colors duration-200 ease-out hover:text-[var(--hud-ink)]"
          style={{ color: "var(--hud-ink-2)", background: "none", border: 0, cursor: "pointer" }}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
      </div>
      <BandKillButton droneId={droneId} />
    </div>
  );
}

export const CockpitTopBar = memo(CockpitTopBarInner);
