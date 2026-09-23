"use client";

/**
 * @module command/settings/UplinkMatrix
 * @description The ground station's uplink matrix (ethernet, Wi-Fi client,
 * cellular, USB tether, access point), the agent-reported active uplink and
 * the failover priority ladder, rendered from the network view the Network
 * page polls. Each leg reads only its own reported fields; a leg the agent did
 * not report reads "not reported", and the active uplink is the agent's own
 * `active_uplink`, never derived here.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";

import type { EthernetConfig, NetworkStatus } from "@/lib/api/ground-station/types";

/** The aggregate view's AP leg carries the setup-AP guard diagnostics beyond
 * the declared `ApStatus`. Additive-optional. */
export interface ApLive {
  enabled?: boolean;
  ssid?: string | null;
  standing_down?: boolean;
  standdown_reason?: string | null;
}

/** The ethernet detail route carries live-link legs beyond the declared
 * `EthernetConfig`. Additive-optional. */
export interface EthernetLive extends EthernetConfig {
  connection_name?: string | null;
  link?: boolean;
  speed_mbps?: number | null;
  current_ip?: string | null;
  current_gateway?: string | null;
}

/** The modem leg across agent generations: current agents report the data-cap
 * legs flat (`percent`), older ones nested under `data_cap`. */
interface ModemLive {
  enabled?: boolean;
  state?: string | null;
  percent?: number | null;
  data_cap?: { percent?: number | null } | null;
}

interface LegState {
  state: string;
  /** False renders the state in the muted "not reported" tone. */
  known: boolean;
  detail: string | null;
}

/**
 * Map an uplink token (an interface-style name from the agent's priority
 * list / active-uplink report, or a legacy leg name) to its label key under
 * `nodeSettings.network`. Unknown tokens return null so the caller renders
 * the raw token instead of guessing.
 */
export function uplinkLegLabelKey(token: string): string | null {
  switch (token) {
    case "eth0":
    case "ethernet":
      return "legEthernet";
    case "wlan0_client":
    case "wifi_client":
      return "legWifi";
    case "wwan0":
    case "modem_4g":
      return "legCellular";
    case "usb0":
    case "usb":
      return "legUsb";
    case "ap":
      return "legAp";
    default:
      return null;
  }
}

/** Move `list[index]` by `delta` positions. Returns the reordered copy, or
 * null when the move is out of range (nothing to write). */
export function moveEntry(
  list: readonly string[],
  index: number,
  delta: -1 | 1,
): string[] | null {
  const target = index + delta;
  if (index < 0 || index >= list.length) return null;
  if (target < 0 || target >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** One uplink-matrix row: leg name, its reported state, an optional mono
 * detail (IP / SSID), and the ACTIVE badge when the agent reports this leg
 * as the one carrying traffic. */
function LegRow({
  label,
  leg,
  active,
  activeLabel,
}: {
  label: string;
  leg: LegState;
  active: boolean;
  activeLabel: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-border-default/40 bg-bg-tertiary px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm text-text-primary">{label}</span>
        {active ? (
          <span className="rounded border border-status-success/40 bg-status-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-success">
            {activeLabel}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-baseline gap-2">
        {leg.detail ? (
          <span className="font-mono text-[11px] text-text-tertiary">
            {leg.detail}
          </span>
        ) : null}
        <span
          className={
            leg.known ? "text-xs text-text-secondary" : "text-xs text-text-tertiary"
          }
        >
          {leg.state}
        </span>
      </div>
    </li>
  );
}

export function UplinkMatrix({
  net,
  ethernet,
  disabled,
  onMovePriority,
}: {
  net: NetworkStatus | null;
  ethernet: EthernetLive | null;
  /** Read-only surface or a ladder write in flight. */
  disabled: boolean;
  onMovePriority: (index: number, delta: -1 | 1) => void;
}) {
  const t = useTranslations("nodeSettings");
  const legLabel = useCallback(
    (token: string): string => {
      const key = uplinkLegLabelKey(token);
      return key ? t(`network.${key}`) : token;
    },
    [t],
  );

  const notReported: LegState = {
    state: t("network.stateNotReported"),
    known: false,
    detail: null,
  };
  const activeToken =
    typeof net?.active_uplink === "string" && net.active_uplink.length > 0
      ? net.active_uplink
      : null;
  const activeLeg = activeToken ? uplinkLegLabelKey(activeToken) : null;

  const ap = (net?.ap ?? null) as ApLive | null;
  const wifi = net?.wifi_client ?? null;
  const modem = (net?.modem_4g ?? net?.modem ?? null) as ModemLive | null;

  const ethernetLeg: LegState = (() => {
    if (!ethernet || typeof ethernet.link !== "boolean") return notReported;
    if (!ethernet.link)
      return { state: t("network.stateNoLink"), known: true, detail: null };
    const ip = ethernet.current_ip ?? ethernet.ip ?? null;
    const speed =
      typeof ethernet.speed_mbps === "number"
        ? `${ethernet.speed_mbps} Mb/s`
        : null;
    return {
      state: t("network.stateLinkUp"),
      known: true,
      detail: [ip, speed].filter(Boolean).join(" · ") || null,
    };
  })();

  const wifiLeg: LegState = (() => {
    if (!wifi || typeof wifi.connected !== "boolean") return notReported;
    if (!wifi.connected)
      return { state: t("network.stateNotConnected"), known: true, detail: null };
    const signal = typeof wifi.signal === "number" ? `${wifi.signal}%` : null;
    return {
      state: t("network.stateConnected"),
      known: true,
      detail:
        [wifi.ssid ?? null, signal, wifi.ip ?? null].filter(Boolean).join(" · ") ||
        null,
    };
  })();

  const apLeg: LegState = (() => {
    if (!ap || typeof ap.enabled !== "boolean") return notReported;
    if (ap.standing_down === true) {
      return {
        state: t("network.stateStandingDown", {
          reason: ap.standdown_reason ?? "unknown",
        }),
        known: true,
        detail: ap.ssid ?? null,
      };
    }
    return {
      state: ap.enabled ? t("network.stateBroadcasting") : t("network.stateOff"),
      known: true,
      detail: ap.enabled ? (ap.ssid ?? null) : null,
    };
  })();

  const modemLeg: LegState = (() => {
    if (!modem || typeof modem.enabled !== "boolean") return notReported;
    if (!modem.enabled)
      return { state: t("network.stateDisabled"), known: true, detail: null };
    const raw = typeof modem.state === "string" ? modem.state : null;
    const percent =
      typeof modem.percent === "number"
        ? modem.percent
        : typeof modem.data_cap?.percent === "number"
          ? modem.data_cap.percent
          : null;
    return {
      state: raw ?? notReported.state,
      known: raw !== null,
      detail: percent !== null ? `${percent.toFixed(0)}%` : null,
    };
  })();

  const priority = net?.priority ?? null;
  const activeBadge = t("network.activeBadge");

  return (
    <>
      {/* Active uplink — the agent's own report, never derived here. */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-text-secondary">
            {t("network.activeLabel")}
          </div>
          <p className="mt-0.5 text-[11px] text-text-tertiary">
            {t("network.activeHint")}
          </p>
        </div>
        <div className="shrink-0 font-mono text-sm text-text-primary">
          {activeToken ? (
            legLabel(activeToken)
          ) : (
            <span className="text-text-tertiary">{t("network.activeNone")}</span>
          )}
        </div>
      </div>

      {/* The uplink matrix, one row per leg. */}
      <ul className="flex flex-col gap-1">
        <LegRow
          label={t("network.legEthernet")}
          leg={ethernetLeg}
          active={activeLeg === "legEthernet"}
          activeLabel={activeBadge}
        />
        <LegRow
          label={t("network.legWifi")}
          leg={wifiLeg}
          active={activeLeg === "legWifi"}
          activeLabel={activeBadge}
        />
        <LegRow
          label={t("network.legCellular")}
          leg={modemLeg}
          active={activeLeg === "legCellular"}
          activeLabel={activeBadge}
        />
        <LegRow
          label={t("network.legUsb")}
          leg={notReported}
          active={activeLeg === "legUsb"}
          activeLabel={activeBadge}
        />
        <LegRow
          label={t("network.legAp")}
          leg={apLeg}
          active={activeLeg === "legAp"}
          activeLabel={activeBadge}
        />
      </ul>

      {/* Failover priority ladder. */}
      <div>
        <div className="mb-1 text-xs text-text-secondary">
          {t("network.priorityTitle")}
        </div>
        <p className="mb-2 text-[11px] text-text-tertiary">
          {t("network.priorityHint")}
        </p>
        {priority && priority.length > 0 ? (
          <ol className="flex flex-col gap-1">
            {priority.map((token, idx) => (
              <li
                key={token}
                className="flex items-center gap-2 rounded border border-border-default/40 bg-bg-tertiary px-3 py-1.5"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-text-tertiary">
                  {idx + 1}
                </span>
                <span className="flex-1 text-sm text-text-primary">
                  {legLabel(token)}
                </span>
                <span className="font-mono text-[10px] text-text-tertiary">
                  {token}
                </span>
                <button
                  type="button"
                  onClick={() => onMovePriority(idx, -1)}
                  disabled={disabled || idx === 0}
                  aria-label={t("network.moveUp", { name: legLabel(token) })}
                  className="rounded border border-border-default p-1 text-text-secondary hover:text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-40"
                >
                  <ArrowUp size={12} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onMovePriority(idx, 1)}
                  disabled={disabled || idx === priority.length - 1}
                  aria-label={t("network.moveDown", { name: legLabel(token) })}
                  className="rounded border border-border-default p-1 text-text-secondary hover:text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-40"
                >
                  <ArrowDown size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-text-tertiary">
            {t("network.priorityEmpty")}
          </p>
        )}
      </div>
    </>
  );
}
