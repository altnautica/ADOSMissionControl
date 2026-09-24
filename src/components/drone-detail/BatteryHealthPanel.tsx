"use client";

/**
 * @module BatteryHealthPanel
 * @description The Live half of a drone's Battery page. Polls the node's
 * battery engine every 2 s and renders each pack (cells with the weakest
 * marked, readings, time-to-reserve prediction, live anomalies) plus the
 * recent raise/clear history across packs.
 *
 * The anomaly rules run on the node, so they keep evaluating with this page
 * closed; the page only surfaces them. A newly raised anomaly is announced
 * once per occurrence (keyed by pack, rule and first-seen time) as a toast,
 * and as a marker on the drone's telemetry recording when one is running.
 *
 * Transport is resolved for THIS node only: its attached direct connection,
 * else its ground station's relay-proxy. With neither, the page says so
 * rather than showing another node's battery.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BatteryMedium } from "lucide-react";

import { AgentClient } from "@/lib/agent/client";
import type { BatteryHealth } from "@/lib/agent/schemas/battery";
import { relayProxyBaseUrl, type RelayReach } from "@/lib/nodes/relay-reach";
import { isRecordingFor, markRecording } from "@/lib/telemetry-recorder";
import { isDemoMode } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { InfoNote, PollFailureNote } from "@/components/command/settings/Section";
import { BatteryPackCard } from "./battery/BatteryPackCard";
import { BatteryHistoryList } from "./battery/BatteryHistoryList";
import { formatRuleValue, ruleLabel } from "./battery/battery-format";

const POLL_MS = 2000;

/** Anomaly occurrences already announced, process-wide, so re-opening the
 * page or switching nodes does not re-announce a live one. Insertion-ordered;
 * the oldest keys are evicted past the cap. */
const ANNOUNCED = new Set<string>();
const ANNOUNCED_CAP = 500;

interface BatteryHealthPanelProps {
  droneId: string;
  /** The node's agent device id (or a relayed drone's peer id). */
  nodeDeviceId: string | null;
  /** The relaying ground station's reach for a WFB-relayed drone, else null. */
  relayReach?: RelayReach | null;
}

interface BatteryRead {
  /** The client the read came from; a read from a previous node is dropped. */
  client: AgentClient | null;
  data: BatteryHealth | null;
  /** The newest poll failed. */
  failed: boolean;
  /** Wall-clock ms of the last successful poll. */
  fetchedAt: number | null;
}

const EMPTY_READ: BatteryRead = { client: null, data: null, failed: false, fetchedAt: null };

export function BatteryHealthPanel({
  droneId,
  nodeDeviceId,
  relayReach = null,
}: BatteryHealthPanelProps) {
  const t = useTranslations("batteryHealth");
  const { toast } = useToast();
  const directClient = useNodeDirectAgent(nodeDeviceId)?.client ?? null;
  // A relayed drone the session is not focused on is still reachable through
  // its ground station's relay-proxy, which serves the same route.
  const client = useMemo(
    () =>
      directClient ??
      (relayReach && !isDemoMode()
        ? new AgentClient(relayProxyBaseUrl(relayReach), relayReach.apiKey, {
            relay: true,
          })
        : null),
    [directClient, relayReach],
  );

  const [read, setRead] = useState<BatteryRead>(EMPTY_READ);
  const current = read.client === client ? read : EMPTY_READ;
  const data = current.data;

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      // A slow relay round-trip must not stack requests behind itself.
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await client.getBatteryHealth();
        if (!cancelled) {
          setRead({ client, data: next, failed: false, fetchedAt: Date.now() });
        }
      } catch {
        if (!cancelled) {
          setRead((prev) =>
            prev.client === client
              ? { ...prev, failed: true }
              : { client, data: null, failed: true, fetchedAt: null },
          );
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client]);

  // Announce each newly raised anomaly once.
  useEffect(() => {
    if (!data?.enabled) return;
    for (const pack of data.packs) {
      for (const anomaly of pack.anomalies) {
        if (anomaly.cleared_at_ms !== null) continue;
        const key = `${droneId}:${pack.id}:${anomaly.rule}:${anomaly.first_seen_ms}`;
        if (ANNOUNCED.has(key)) continue;
        ANNOUNCED.add(key);
        if (ANNOUNCED.size > ANNOUNCED_CAP) {
          const oldest = ANNOUNCED.values().next().value;
          if (oldest !== undefined) ANNOUNCED.delete(oldest);
        }
        toast(
          t("alert", {
            pack: pack.id,
            rule: ruleLabel(t, anomaly.rule),
            value: formatRuleValue(anomaly.rule, anomaly.value),
          }),
          anomaly.severity === "critical" ? "error" : "warning",
        );
        if (isRecordingFor(droneId)) {
          markRecording(droneId, `battery:${anomaly.rule}`, {
            pack_id: pack.id,
            severity: anomaly.severity,
            value: anomaly.value,
            threshold: anomaly.threshold,
          });
        }
      }
    }
  }, [data, droneId, t, toast]);

  return (
    <div className="flex-1 overflow-y-auto p-3" data-testid="battery-live">
      <div className="mb-3 flex items-center gap-2">
        <BatteryMedium size={15} className="text-accent-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>
      </div>
      <p className="mb-4 text-xs text-text-tertiary">{t("subtitle")}</p>

      {!client ? (
        <InfoNote>{t("unavailable")}</InfoNote>
      ) : (
        <div className="space-y-3">
          <PollFailureNote
            failed={current.failed}
            fetchedAt={current.fetchedAt}
            message={t("loadFailed")}
          />
          {data === null ? (
            current.failed ? null : <InfoNote>{t("loading")}</InfoNote>
          ) : !data.enabled ? (
            <InfoNote>{t("disabled")}</InfoNote>
          ) : data.packs.length === 0 ? (
            <InfoNote>{t("noPacks")}</InfoNote>
          ) : (
            <>
              {data.stale ? (
                <div
                  role="status"
                  className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[11px] text-status-warning"
                >
                  {t("stale")}
                </div>
              ) : null}
              <div className="grid gap-3 xl:grid-cols-2">
                {data.packs.map((pack) => (
                  <BatteryPackCard
                    key={pack.id}
                    pack={pack}
                    reservePercent={data.thresholds.reserve_percent}
                  />
                ))}
              </div>
              <BatteryHistoryList packs={data.packs} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
