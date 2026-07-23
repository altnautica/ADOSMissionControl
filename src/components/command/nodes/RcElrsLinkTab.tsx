"use client";

/**
 * @module command/nodes/RcElrsLinkTab
 * @description Node-detail tab for the CRSF / ExpressLRS control lane the
 * ados-crsf service transmits (the ground node is the transmitter; a drone can
 * host an agent-relay ELRS TX). Reads the per-node `crsf` snapshot from the
 * capability store and renders the lane state, link statistics, transmit power
 * / band, control mode, channel source, pilot-in-command authority, and relay
 * role.
 *
 * Honesty is the whole point of this surface (see the truthful-status-surface
 * discipline): a transmitting-but-unconfirmed lane reads `rf_unverified` as
 * itself, never "connected"; a MAVLink-over-ELRS lane whose command path is
 * gated shows that commands are NOT reaching the flight controller; an
 * unavailable PIC arbiter says so; and an unmeasured value reads "…", never a
 * fabricated zero. When no lane is advertised the tab renders an explicit empty
 * state (the surface registry also gates the tab off, but the component never
 * blanks on a null block).
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import {
  RadioTower,
  ShieldAlert,
  AlertTriangle,
  Gamepad2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { RcInputCard } from "@/components/command/shared/RcInputCard";
import type {
  CrsfLinkState,
  CrsfState,
} from "@/lib/api/ground-station/types";

const EMPTY = "…";

type BadgeTone = "success" | "accent" | "warning" | "muted";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "border-status-success/40 bg-status-success/10 text-status-success",
  accent: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  warning: "border-status-warning/40 bg-status-warning/10 text-status-warning",
  muted: "border-border-default bg-bg-tertiary text-text-tertiary",
};

// Map each coarse lane state to its i18n leaf + a tone. rf_unverified is amber
// like degraded but reads as its own distinct label (transmitting, reception
// unproven) and carries the ShieldAlert glyph, never collapsed to connected.
const STATE_META: Record<CrsfLinkState, { key: string; tone: BadgeTone }> = {
  link_ok: { key: "linkOk", tone: "success" },
  ready: { key: "ready", tone: "accent" },
  unconfigured: { key: "unconfigured", tone: "muted" },
  degraded: { key: "degraded", tone: "warning" },
  rf_unverified: { key: "rfUnverified", tone: "warning" },
  disabled: { key: "disabled", tone: "muted" },
};

// Link-quality colour thresholds (percent).
const LQ_GREEN = 90;
const LQ_YELLOW = 70;
// RSSI colour thresholds (dBm).
const RSSI_GREEN_DBM = -60;
const RSSI_YELLOW_DBM = -85;

function lqClass(lq: number | null): string {
  if (lq == null) return "text-text-tertiary";
  if (lq >= LQ_GREEN) return "text-status-success";
  if (lq >= LQ_YELLOW) return "text-status-warning";
  return "text-status-error";
}

function rssiClass(dbm: number | null): string {
  if (dbm == null) return "text-text-tertiary";
  if (dbm >= RSSI_GREEN_DBM) return "text-status-success";
  if (dbm >= RSSI_YELLOW_DBM) return "text-status-warning";
  return "text-status-error";
}

const dbm = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(0)} dBm`);
const pct = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(0)}%`);
const db = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(0)} dB`);
const hz = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(0)} Hz`);
const mw = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(0)} mW`);
const perS = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(0)}/s`);

type T = ReturnType<typeof useTranslations>;

/** Control mode label. Known modes get a friendly string; any other value is
 * shown verbatim (honest, not fabricated); null reads "…". */
function modeLabel(mode: string | null, t: T): string {
  if (mode == null) return EMPTY;
  const n = mode.toLowerCase();
  if (n === "crsf_rc") return t("mode.crsfRc");
  if (n === "mavlink_elrs") return t("mode.mavlinkElrs");
  return mode;
}

/** Channel-source label (handset HID / injection API / hybrid), verbatim
 * fallback for an unknown source, "…" when unreported. */
function channelSourceLabel(src: string | null, t: T): string {
  if (src == null) return EMPTY;
  const n = src.toLowerCase();
  if (n === "hid") return t("channelSource.hid");
  if (n === "inject") return t("channelSource.inject");
  if (n === "hybrid") return t("channelSource.hybrid");
  return src;
}

/** Pilot-in-command arbiter label. `unavailable` reads "Arbiter unavailable"
 * honestly; a named holder reads "Held by <holder>"; null (the heartbeat
 * projection drops pic) reads "Not reported", never a fabricated holder. */
function picLabel(pic: string | null, t: T): string {
  if (pic == null) return t("pic.notReported");
  const n = pic.toLowerCase();
  if (n === "unavailable") return t("pic.unavailable");
  if (n === "unclaimed" || n === "none") return t("pic.unclaimed");
  if (n === "claimed") return t("pic.claimed");
  return t("pic.heldBy", { holder: pic });
}

interface StatRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

function StatRow({ label, value, valueClass }: StatRowProps) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-default py-1.5">
      <dt className="text-xs uppercase tracking-wide text-text-secondary">
        {label}
      </dt>
      <dd className={cn("font-mono text-sm", valueClass ?? "text-text-primary")}>
        {value}
      </dd>
    </div>
  );
}

interface RcElrsLinkTabProps {
  /** Test seam: render against an explicit snapshot instead of the store. */
  crsf?: CrsfState | null;
}

export function RcElrsLinkTab({ crsf: crsfProp }: RcElrsLinkTabProps = {}) {
  const t = useTranslations("rcElrsLink");
  const crsfFromStore = useAgentCapabilitiesStore((s) => s.crsf);
  const crsf = crsfProp !== undefined ? crsfProp : crsfFromStore;

  // No lane advertised: an explicit empty state, never a blank body and never
  // fabricated data. The surface registry also gates the tab off when the node
  // has no crsf block, so this path is the defensive fallback.
  if (!crsf) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary text-text-tertiary">
          <RadioTower size={24} />
        </div>
        <h2 className="text-sm font-display font-semibold text-text-primary">
          {t("empty.title")}
        </h2>
        <p className="mt-2 max-w-sm text-xs text-text-tertiary">
          {t("empty.body")}
        </p>
      </div>
    );
  }

  const state = crsf.state;
  const meta = state ? STATE_META[state] : { key: "unknown", tone: "muted" as BadgeTone };
  const StateIcon =
    state === "rf_unverified"
      ? ShieldAlert
      : state === "degraded"
        ? AlertTriangle
        : RadioTower;

  // The transmit-proof verdict is its own tri-state field. Surface it as a
  // distinct chip only when the coarse state does not already say it, so the
  // "transmitting, reception unproven" fact is never lost even if the lane
  // reports another coarse state alongside an unverified verdict.
  const showUnverifiedChip =
    crsf.rfUnverified === true && state !== "rf_unverified";
  const commandGated = crsf.fcCommandDownGated === true;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-1 flex items-center gap-2">
          <RadioTower size={16} className="text-accent-primary" />
          <h2 className="text-sm font-semibold text-text-primary">
            {t("title")}
          </h2>
        </div>
        <p className="mb-4 text-xs text-text-tertiary">{t("description")}</p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs",
              TONE_CLASS[meta.tone],
            )}
          >
            <StateIcon size={12} />
            {t(`state.${meta.key}`)}
          </span>
          {showUnverifiedChip ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-status-warning/40 bg-status-warning/10 px-2.5 py-1 text-xs text-status-warning">
              <ShieldAlert size={12} />
              {t("rfUnverifiedBadge")}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 rounded border border-border-default bg-bg-tertiary px-2.5 py-1 text-xs text-text-tertiary">
            {modeLabel(crsf.mode, t)}
          </span>
          {crsf.relayRole ? (
            <span className="inline-flex items-center gap-1.5 rounded border border-accent-primary/40 bg-accent-primary/10 px-2.5 py-1 text-xs text-accent-primary">
              {t("relayBadge", { role: crsf.relayRole })}
            </span>
          ) : null}
        </div>

        {/* Safety-critical caveats render as VISIBLE text, never hover-gated. */}
        {state === "rf_unverified" || crsf.rfUnverified === true ? (
          <p className="mb-3 flex items-start gap-2 rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
            <ShieldAlert size={14} className="mt-px shrink-0" />
            <span>{t("rfUnverifiedCaveat")}</span>
          </p>
        ) : null}

        {commandGated ? (
          <div
            role="alert"
            className="mb-3 rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-status-warning"
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              <AlertTriangle size={14} className="shrink-0" />
              {t("commandDownGated.title")}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed">
              {t("commandDownGated.body")}
            </p>
          </div>
        ) : null}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2">
          <StatRow
            label={t("stats.rssi")}
            value={dbm(crsf.rssiDbm)}
            valueClass={rssiClass(crsf.rssiDbm)}
          />
          <StatRow
            label={t("stats.snr")}
            value={db(crsf.snrDb)}
          />
          <StatRow
            label={t("stats.lqUplink")}
            value={pct(crsf.lqUplink)}
            valueClass={lqClass(crsf.lqUplink)}
          />
          <StatRow
            label={t("stats.lqDownlink")}
            value={pct(crsf.lqDownlink)}
            valueClass={lqClass(crsf.lqDownlink)}
          />
          <StatRow label={t("stats.band")} value={crsf.band ?? EMPTY} />
          <StatRow label={t("stats.packetRate")} value={hz(crsf.packetRateHz)} />
          <StatRow label={t("stats.txPower")} value={mw(crsf.txPowerMw)} />
          <StatRow label={t("stats.txFrames")} value={perS(crsf.txFramesPerS)} />
          <StatRow label={t("stats.rxFrames")} value={perS(crsf.rxFramesPerS)} />
          <StatRow label={t("stats.mode")} value={modeLabel(crsf.mode, t)} />
          <StatRow
            label={t("stats.channelSource")}
            value={channelSourceLabel(crsf.channelSource, t)}
          />
          <StatRow label={t("stats.pic")} value={picLabel(crsf.pic, t)} />
          <StatRow
            label={t("stats.relayRole")}
            value={crsf.relayRole ?? t("relayRoleNone")}
          />
        </dl>

        {/* TX power + band are shown above, so the RF-compliance reminder sits
            here. Transmit power and band are hardware-bounded, not region-gated,
            unless the operator pins a region. */}
        <p className="mt-3 flex items-start gap-2 text-[11px] text-status-warning">
          <ShieldAlert size={13} className="mt-px shrink-0" />
          <span>{t("rfComplianceNote")}</span>
        </p>
      </section>

      <section className="rounded border border-border-default bg-bg-secondary p-5">
        <div className="mb-3 flex items-center gap-2">
          <Gamepad2 size={16} className="text-accent-primary" />
          <h3 className="text-sm font-semibold text-text-primary">
            {t("channelsTitle")}
          </h3>
        </div>
        <p className="mb-3 text-xs text-text-tertiary">{t("channelsHint")}</p>
        {/* Reuse the shared RC input card; it shows the live channel bars where
            channel data is available and its own waiting state otherwise. */}
        <RcInputCard />
      </section>
    </div>
  );
}
