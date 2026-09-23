"use client";

/**
 * @module command/settings/CellularSection
 * @description The node Settings "Cellular" page, offered on a ground station
 * only: it is the one profile whose agent runs a modem manager. It binds to
 * the agent's modem surface: presence read-only from the node's own
 * modem-status snapshot, the modem view's config + usage legs, and writes
 * (enable, APN, data cap) whose response IS the read-back — the agent replies
 * with the modem view over the freshly-persisted config. Connectivity legs
 * that carry the manager's no-modem sentinels (`signal_quality: -1`,
 * `technology: "unknown"`, empty operator) and usage the tracker has not
 * reported yet (null) render as unknown, never as facts.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Signal } from "lucide-react";

import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { ModemDetailStatus, ModemView } from "@/lib/api/ground-station/types";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { ApplyTextField } from "./ApplyTextField";
import { useNodeDirectAgent } from "./use-node-direct-agent";
import { InfoNote, PollFailureNote, ReadRow, Section } from "./Section";

const POLL_MS = 10000;

interface SectionProps {
  /** The node this page is rendered for; live reads and writes go only to a
   * connection attached to it. */
  nodeDeviceId: string | null;
  profile: NodeProfile;
  readOnly: boolean;
}

/** Format the configured data cap (MB) as a GB input string. */
export function capMbToGbString(capMb: number | null | undefined): string {
  if (typeof capMb !== "number" || !Number.isFinite(capMb) || capMb <= 0)
    return "";
  return String(Math.round((capMb / 1024) * 100) / 100);
}

/** Parse an operator-typed data-cap value in GB. Returns the number (0 clears
 * the cap) or null when the input is not a non-negative finite number. */
export function parseCapGb(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function CellularSection({
  nodeDeviceId,
  profile,
  readOnly,
}: SectionProps) {
  const t = useTranslations("nodeSettings");
  const { toast } = useToast();
  const agent = useNodeDirectAgent(nodeDeviceId);

  const isGroundStation = profile === "ground-station";
  const api = useMemo(
    () =>
      isGroundStation && agent
        ? groundStationApiFromAgent(agent.agentUrl, agent.apiKey)
        : null,
    [isGroundStation, agent],
  );
  // Answers belong to the client they were requested on; a poll or write
  // reply from the previously attached node that lands after a switch is
  // dropped.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  const [modem, setModem] = useState<ModemView | null>(null);
  /** Wall-clock ms of the last modem view that landed (poll or write). */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [detail, setDetail] = useState<ModemDetailStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [togglePending, setTogglePending] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const view = await api.getModem();
      if (apiRef.current !== api) return;
      setModem(view);
      setFetchedAt(Date.now());
      setLoadFailed(false);
    } catch {
      if (apiRef.current !== api) return;
      setLoadFailed(true);
    }
    try {
      const next = await api.getModemDetail();
      if (apiRef.current !== api) return;
      setDetail(next);
    } catch {
      if (apiRef.current !== api) return;
      setDetail(null);
    }
  }, [api]);

  useEffect(() => {
    // A new client (or none) starts from nothing: the previous node's modem
    // view never renders under this node's name while the first poll runs.
    setModem(null);
    setFetchedAt(null);
    setDetail(null);
    setLoadFailed(false);
    if (!api) return;
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

  /** Write a modem-config change; the agent's response is the modem view
   * over the freshly-persisted config, so rendering it IS the read-back. */
  const writeModem = useCallback(
    async (update: { apn?: string; cap_gb?: number; enabled?: boolean }) => {
      if (!api) throw new Error(t("network.liveRequiresLan"));
      const view = await api.setModem(update);
      if (apiRef.current !== api) return;
      setModem(view);
      setFetchedAt(Date.now());
    },
    [api, t],
  );

  const onToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (togglePending) return;
      setTogglePending(true);
      try {
        await writeModem({ enabled });
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
      } finally {
        setTogglePending(false);
      }
    },
    [togglePending, writeModem, toast, t],
  );

  const applyText = useCallback(
    async (update: { apn?: string; cap_gb?: number }) => {
      try {
        await writeModem(update);
        toast(t("applied"), "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : t("applyFailed"), "error");
        throw err;
      }
    },
    [writeModem, toast, t],
  );

  // Only a ground station runs a modem manager; the page is not offered
  // elsewhere, and renders nothing if reached anyway.
  if (!isGroundStation) return null;

  // ---- presence + facts (unknown renders unknown, sentinels excluded) -----

  const presence = (() => {
    if (!detail) return t("cellular.presenceUnknown");
    if (detail.present === true) return t("cellular.presenceDetected");
    switch (detail.reason) {
      case "no_modem":
        return t("cellular.presenceNone");
      case "modemmanager_not_installed":
        return t("cellular.presenceNoManager");
      default:
        // `not_probed` and any reason this build does not know: the agent
        // did not look, so nothing is claimed either way.
        return t("cellular.presenceUnknown");
    }
  })();

  const stateText =
    typeof modem?.state === "string" && modem.state.length > 0
      ? modem.state
      : t("cellular.stateUnknown");
  const operator =
    typeof modem?.operator === "string" && modem.operator.length > 0
      ? modem.operator
      : null;
  const technology =
    typeof modem?.technology === "string" &&
    modem.technology.length > 0 &&
    modem.technology !== "unknown"
      ? modem.technology
      : null;
  const signalQuality =
    typeof modem?.signal_quality === "number" && modem.signal_quality >= 0
      ? modem.signal_quality
      : null;
  const capMb = typeof modem?.cap_mb === "number" ? modem.cap_mb : null;
  const usedMb =
    typeof modem?.data_used_mb === "number" ? modem.data_used_mb : null;
  const percent = typeof modem?.percent === "number" ? modem.percent : null;

  // The tracker reports usage as null until its first event: that is "not
  // reported", never 0 MB — a modem near its cap would otherwise read empty.
  const usageText =
    capMb === null || capMb <= 0
      ? null
      : usedMb === null
        ? t("cellular.usageNotReported")
        : t("cellular.usedOfCap", {
            used: usedMb,
            cap: capMb,
            percent: (percent ?? (usedMb / capMb) * 100).toFixed(0),
          });

  return (
    <Section
      title={t("cellular.title")}
      icon={Signal}
      blurb={t("cellular.blurb")}
    >
      {!api ? (
        <InfoNote>{t("network.liveRequiresLan")}</InfoNote>
      ) : (
        <>
          <PollFailureNote
            failed={loadFailed}
            fetchedAt={modem ? fetchedAt : null}
            message={t("cellular.loadFailed")}
          />

          {/* Presence + reported connection facts — read-only. */}
          <div className="space-y-2">
            <ReadRow label={t("cellular.presenceLabel")} value={presence} />
            {modem ? (
              <>
                <ReadRow label={t("cellular.stateLabel")} value={stateText} />
                {operator ? (
                  <ReadRow label={t("cellular.operatorLabel")} value={operator} />
                ) : null}
                {technology ? (
                  <ReadRow
                    label={t("cellular.technologyLabel")}
                    value={technology}
                  />
                ) : null}
                {signalQuality !== null ? (
                  <ReadRow
                    label={t("cellular.signalLabel")}
                    value={`${signalQuality}%`}
                  />
                ) : null}
                {typeof modem.ip === "string" && modem.ip.length > 0 ? (
                  <ReadRow label={t("cellular.ipLabel")} value={modem.ip} />
                ) : null}
              </>
            ) : null}
          </div>

          {modem ? (
            <>
              {/* Data usage against the configured cap. */}
              <div className="space-y-2 border-t border-border-default pt-3">
                <div className="text-xs text-text-secondary">
                  {t("cellular.usageTitle")}
                </div>
                {usageText !== null ? (
                  <ReadRow label={t("cellular.usedLabel")} value={usageText} />
                ) : (
                  <p className="text-[11px] text-text-tertiary">
                    {t("cellular.noCap")}
                  </p>
                )}
              </div>

              {/* Writes — each response is the persisted modem view. */}
              <div className="space-y-4 border-t border-border-default pt-3">
                <Toggle
                  label={t("cellular.enabledLabel")}
                  checked={modem.enabled === true}
                  onChange={(v) => void onToggleEnabled(v)}
                  disabled={readOnly || togglePending}
                />
                <p className="-mt-3 text-[11px] text-text-tertiary">
                  {t("cellular.enabledHint")}
                </p>

                <ApplyTextField
                  label={t("cellular.apnLabel")}
                  hint={t("cellular.apnHint")}
                  placeholder={t("cellular.apnPlaceholder")}
                  current={typeof modem.apn === "string" ? modem.apn : ""}
                  disabled={readOnly}
                  onApply={(v) => applyText({ apn: v })}
                />

                <ApplyTextField
                  label={t("cellular.capLabel")}
                  hint={t("cellular.capHint")}
                  placeholder="0"
                  current={capMbToGbString(capMb)}
                  disabled={readOnly}
                  validate={(v) =>
                    parseCapGb(v) === null ? t("cellular.capInvalid") : null
                  }
                  onApply={(v) => {
                    const gb = parseCapGb(v);
                    if (gb === null)
                      return Promise.reject(new Error(t("cellular.capInvalid")));
                    return applyText({ cap_gb: gb });
                  }}
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}
