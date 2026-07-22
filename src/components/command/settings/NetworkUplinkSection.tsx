"use client";

/**
 * @module command/settings/NetworkUplinkSection
 * @description The node Settings "Network" page: the uplink matrix (ethernet,
 * Wi-Fi client, USB tether, cellular, access point) with the failover priority
 * ladder and the share-uplink toggle, plus the config-backed hotspot switch.
 *
 * The uplink matrix, priority ladder and share toggle are served by the
 * agent's ground-station network surface, so they render on a ground-station
 * node only; other profiles say so honestly instead of showing an empty
 * matrix. The ACTIVE uplink is the agent's own report (`active_uplink` from
 * the aggregate network view) — never derived client-side; when the node has
 * not reported one it reads "not reported".
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Network } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { EthernetConfig, NetworkStatus } from "@/lib/api/ground-station/types";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { ConfigToggleField } from "./ConfigFields";
import { Section } from "./Section";

const POLL_MS = 5000;

interface SectionProps {
  profile: NodeProfile;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

/** The aggregate view's AP leg carries the setup-AP guard diagnostics beyond
 * the declared `ApStatus`; the ethernet detail route carries live-link legs
 * beyond the declared `EthernetConfig`. Both are additive-optional. */
interface ApLive {
  enabled?: boolean;
  ssid?: string | null;
  standing_down?: boolean;
  standdown_reason?: string | null;
}

interface EthernetLive extends EthernetConfig {
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

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2 text-[11px] text-text-tertiary">
      {children}
    </div>
  );
}

/** One uplink-matrix row: leg name, its reported state, an optional mono
 * detail (IP / SSID), and the ACTIVE badge when the agent reports this leg
 * as the one carrying traffic. */
function LegRow({
  label,
  state,
  known,
  detail,
  active,
  activeLabel,
}: {
  label: string;
  state: string;
  /** False renders the state in the muted "not reported" tone. */
  known: boolean;
  detail?: string | null;
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
        {detail ? (
          <span className="font-mono text-[11px] text-text-tertiary">{detail}</span>
        ) : null}
        <span
          className={
            known ? "text-xs text-text-secondary" : "text-xs text-text-tertiary"
          }
        >
          {state}
        </span>
      </div>
    </li>
  );
}

export function NetworkUplinkSection({
  profile,
  config,
  readOnly,
  setValue,
}: SectionProps) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const isGroundStation = profile === "ground-station";
  const api = useMemo(
    () => (isGroundStation ? groundStationApiFromAgent(agentUrl, apiKey) : null),
    [isGroundStation, agentUrl, apiKey],
  );

  const [net, setNet] = useState<NetworkStatus | null>(null);
  const [ethernet, setEthernet] = useState<EthernetLive | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingShare, setSavingShare] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const status = await api.getNetwork();
      setNet(status);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
    // The aggregate view's ethernet leg is a static default on current
    // agents; the dedicated ethernet route carries the live link legs. Its
    // absence (older agents) leaves the row on "not reported".
    try {
      const eth = (await api.getEthernetConfig()) as EthernetLive;
      setEthernet(eth);
    } catch {
      setEthernet(null);
    }
  }, [api]);

  useEffect(() => {
    if (!api) {
      setNet(null);
      setEthernet(null);
      setLoadFailed(false);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void refresh();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, refresh]);

  const legLabel = useCallback(
    (token: string): string => {
      const key = uplinkLegLabelKey(token);
      return key ? t(`network.${key}`) : token;
    },
    [t],
  );

  const onMovePriority = useCallback(
    async (index: number, delta: -1 | 1) => {
      if (!api || savingPriority) return;
      const current = net?.priority;
      if (!current) return;
      const next = moveEntry(current, index, delta);
      if (!next) return;
      setSavingPriority(true);
      try {
        // Read-back: the write returns the persisted list; render that, not
        // the optimistic order.
        const res = await api.setPriority(next);
        setNet((n) => (n ? { ...n, priority: res.priority } : n));
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setSavingPriority(false);
      }
    },
    [api, savingPriority, net, toast, t],
  );

  const onShareToggle = useCallback(
    async (enabled: boolean) => {
      if (!api || savingShare) return;
      setSavingShare(true);
      try {
        const res = await api.setShareUplink(enabled);
        setNet((n) => (n ? { ...n, share_uplink: res.enabled } : n));
        if (res.applied === false) {
          // Persisted but not applied to a live uplink — surface the agent's
          // reason instead of a clean success.
          toast(
            t("network.sharePersistedNotApplied", {
              reason: res.apply_error ?? "unknown",
            }),
            "warning",
          );
        } else {
          toast(t("applied"), "success");
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setSavingShare(false);
      }
    },
    [api, savingShare, toast, t],
  );

  // ---- row state derivation (each leg reads only its own reported fields) --

  const notReported = t("network.stateNotReported");
  const activeToken =
    typeof net?.active_uplink === "string" && net.active_uplink.length > 0
      ? net.active_uplink
      : null;
  const activeLeg = activeToken ? uplinkLegLabelKey(activeToken) : null;

  const ap = (net?.ap ?? null) as ApLive | null;
  const wifi = net?.wifi_client ?? null;
  const modem = (net?.modem_4g ?? net?.modem ?? null) as ModemLive | null;

  const ethernetState = (() => {
    if (!ethernet || typeof ethernet.link !== "boolean")
      return { state: notReported, known: false, detail: null as string | null };
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

  const wifiState = (() => {
    if (!wifi || typeof wifi.connected !== "boolean")
      return { state: notReported, known: false, detail: null as string | null };
    if (!wifi.connected)
      return { state: t("network.stateNotConnected"), known: true, detail: null };
    const signal =
      typeof wifi.signal === "number" ? `${wifi.signal}%` : null;
    return {
      state: t("network.stateConnected"),
      known: true,
      detail:
        [wifi.ssid ?? null, signal, wifi.ip ?? null].filter(Boolean).join(" · ") ||
        null,
    };
  })();

  const apState = (() => {
    if (!ap || typeof ap.enabled !== "boolean")
      return { state: notReported, known: false, detail: null as string | null };
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
      state: ap.enabled
        ? t("network.stateBroadcasting")
        : t("network.stateOff"),
      known: true,
      detail: ap.enabled ? (ap.ssid ?? null) : null,
    };
  })();

  const modemState = (() => {
    if (!modem || typeof modem.enabled !== "boolean")
      return { state: notReported, known: false, detail: null as string | null };
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
      state: raw ?? notReported,
      known: raw !== null,
      detail: percent !== null ? `${percent.toFixed(0)}%` : null,
    };
  })();

  const priority = net?.priority ?? null;

  return (
    <Section
      title={t("network.title")}
      icon={Network}
      blurb={t("network.blurb")}
    >
      {isGroundStation ? (
        !api ? (
          <InfoNote>{t("network.liveRequiresLan")}</InfoNote>
        ) : (
          <>
            {loadFailed && !net ? (
              <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
                {t("network.loadFailed")}
              </div>
            ) : null}

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
                  <span className="text-text-tertiary">
                    {t("network.activeNone")}
                  </span>
                )}
              </div>
            </div>

            {/* The uplink matrix, one row per leg. */}
            <ul className="flex flex-col gap-1">
              <LegRow
                label={t("network.legEthernet")}
                state={ethernetState.state}
                known={ethernetState.known}
                detail={ethernetState.detail}
                active={activeLeg === "legEthernet"}
                activeLabel={t("network.activeBadge")}
              />
              <LegRow
                label={t("network.legWifi")}
                state={wifiState.state}
                known={wifiState.known}
                detail={wifiState.detail}
                active={activeLeg === "legWifi"}
                activeLabel={t("network.activeBadge")}
              />
              <LegRow
                label={t("network.legCellular")}
                state={modemState.state}
                known={modemState.known}
                detail={modemState.detail}
                active={activeLeg === "legCellular"}
                activeLabel={t("network.activeBadge")}
              />
              <LegRow
                label={t("network.legUsb")}
                state={notReported}
                known={false}
                active={activeLeg === "legUsb"}
                activeLabel={t("network.activeBadge")}
              />
              <LegRow
                label={t("network.legAp")}
                state={apState.state}
                known={apState.known}
                detail={apState.detail}
                active={activeLeg === "legAp"}
                activeLabel={t("network.activeBadge")}
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
                        onClick={() => void onMovePriority(idx, -1)}
                        disabled={readOnly || savingPriority || idx === 0}
                        aria-label={t("network.moveUp", {
                          name: legLabel(token),
                        })}
                        className="rounded border border-border-default p-1 text-text-secondary hover:text-text-primary focus:border-accent-primary focus:outline-none disabled:opacity-40"
                      >
                        <ArrowUp size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onMovePriority(idx, 1)}
                        disabled={
                          readOnly ||
                          savingPriority ||
                          idx === priority.length - 1
                        }
                        aria-label={t("network.moveDown", {
                          name: legLabel(token),
                        })}
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

            {/* Share uplink with AP clients. Rendered only once the live view
                reports the real current value. */}
            {net && typeof net.share_uplink === "boolean" ? (
              <div className="flex flex-col gap-1.5">
                <Toggle
                  label={t("network.shareLabel")}
                  checked={net.share_uplink}
                  onChange={(v) => void onShareToggle(v)}
                  disabled={readOnly || savingShare}
                />
                <p className="text-[11px] text-text-tertiary">
                  {t("network.shareHint")}
                </p>
              </div>
            ) : null}
          </>
        )
      ) : (
        <InfoNote>{t("network.uplinkUnsupportedProfile")}</InfoNote>
      )}

      {/* Config-backed hotspot switch — every profile. */}
      <ConfigToggleField
        configKey="network.hotspot.enabled"
        label={t("network.hotspotLabel")}
        hint={t("network.hotspotHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
    </Section>
  );
}
