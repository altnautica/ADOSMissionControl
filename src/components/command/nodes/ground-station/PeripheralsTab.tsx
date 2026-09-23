"use client";

/**
 * @module PeripheralsTab
 * @description Command-tab home for the Peripheral Manager. Lists
 * registered peripheral plugins reported by the agent. When no
 * plugins are registered the backend returns {peripherals: [],
 * count: 0} and we render an empty state.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plug, RefreshCw } from "lucide-react";
import { PageIntro } from "@/components/hardware/PageIntro";
import { Button } from "@/components/ui/button";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { PeripheralSummary } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { PluginHardwarePanels } from "@/components/command/system/PluginHardwarePanels";
import { useGroundStationPoll } from "./use-gs-poll";

const POLL_INTERVAL_MS = 5000;
const RESCAN_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`request timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function PeripheralsTab() {
  const t = useTranslations("hardware");

  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const agentClient = useAgentConnectionStore((s) => s.client);

  const peripherals = useGroundStationStore((s) => s.peripherals);
  const loadPeripherals = useGroundStationStore((s) => s.loadPeripherals);
  const loadPeripheralDetail = useGroundStationStore(
    (s) => s.loadPeripheralDetail,
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);


  const onRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    setRescanError(null);
    try {
      // Nudge the agent's hardware-bus rescan first, then refresh the
      // plugin-manager view so the user gets an immediate update instead
      // of waiting on the 5s poll.
      if (agentClient) {
        try {
          await withTimeout(agentClient.scanPeripherals(), RESCAN_TIMEOUT_MS);
        } catch (err) {
          // Hardware-bus rescan is best-effort; don't fail the whole
          // action if only the v0 endpoint trips.
          console.warn("scanPeripherals failed:", err);
        }
      }
      const client = groundStationApiFromAgent(agentUrl, apiKey);
      if (client) {
        await withTimeout(loadPeripherals(client), RESCAN_TIMEOUT_MS);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setRescanError(msg);
    } finally {
      setRescanning(false);
    }
  };

  // Self-scheduling with backoff; see `use-gs-poll`.
  useGroundStationPoll(agentUrl, apiKey, POLL_INTERVAL_MS, loadPeripherals);

  const onToggleRow = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const client = groundStationApiFromAgent(agentUrl, apiKey);
    if (!client) return;
    void loadPeripheralDetail(client, id);
  };

  const rows = useMemo(() => peripherals.list, [peripherals.list]);
  const onCloudOnly = !agentUrl;

  return (
    <div className="flex flex-col">
      <PageIntro
        title="Peripherals"
        description="Plugin-managed peripherals declared by the agent: cameras, sensors, custom hardware."
        trailing={
          onCloudOnly ? null : (
            <Button
              variant="secondary"
              size="sm"
              onClick={onRescan}
              disabled={rescanning}
            >
              <RefreshCw
                size={14}
                className={rescanning ? "mr-1.5 animate-spin" : "mr-1.5"}
              />
              {rescanning ? t("common.scanning") : t("common.rescan")}
            </Button>
          )
        }
      />
      {onCloudOnly ? <CloudModeLimitedNotice feature="peripherals" /> : null}
      {peripherals.error ? (
        <div className="mb-4 rounded border border-status-error/50 bg-status-error/10 px-4 py-3 text-sm text-status-error">
          {peripherals.error}
        </div>
      ) : null}
      {rescanError ? (
        <div className="mb-4 rounded border border-status-warning/40 bg-status-warning/10 px-4 py-3 text-sm text-status-warning">
          {t("common.rescanFailed", { error: rescanError })}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary text-text-tertiary">
            <Plug size={24} />
          </div>
          <h2 className="text-sm font-display font-semibold text-text-primary">
            {t("peripherals.emptyState")}
          </h2>
          <p className="mt-2 max-w-md text-xs text-text-tertiary leading-relaxed">
            The agent has not declared any peripheral plugins yet. Plug a sensor,
            camera, or other peripheral and the entry will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-border-default">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary text-left text-xs uppercase text-text-secondary">
              <tr>
                <th className="px-3 py-2">{t("peripherals.name")}</th>
                <th className="px-3 py-2">{t("peripherals.transport")}</th>
                <th className="px-3 py-2">{t("peripherals.connected")}</th>
                <th className="px-3 py-2">
                  {t("peripherals.capabilities")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p: PeripheralSummary) => {
                const isOpen = expandedId === p.id;
                const detail = peripherals.detail[p.id];
                return (
                  <PeripheralRow
                    key={p.id}
                    summary={p}
                    isOpen={isOpen}
                    detail={detail}
                    onToggle={() => onToggleRow(p.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Fleet hardware.tab slot — a GCS-level plugin's hardware panels render
          here too, below the agent-declared peripherals. */}
      <div className="mt-4">
        <PluginHardwarePanels />
      </div>
    </div>
  );
}

interface RowProps {
  summary: PeripheralSummary;
  isOpen: boolean;
  detail: import("@/lib/api/ground-station-api").PeripheralDetail | undefined;
  onToggle: () => void;
}

function PeripheralRow({ summary, isOpen, detail, onToggle }: RowProps) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border-default hover:bg-bg-secondary"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-text-primary">{summary.display_name}</td>
        <td className="px-3 py-2 text-text-secondary">{summary.transport}</td>
        <td className="px-3 py-2">
          <span
            className={
              summary.connected
                ? "text-status-success"
                : "text-text-secondary"
            }
          >
            {summary.connected ? "Yes" : "No"}
          </span>
        </td>
        <td className="px-3 py-2 text-text-secondary">
          {summary.capabilities.length > 0
            ? summary.capabilities.join(", ")
            : "-"}
        </td>
      </tr>
      {isOpen ? (
        <tr className="border-t border-border-default bg-bg-secondary/50">
          <td colSpan={4} className="px-4 py-3">
            {detail ? (
              <div className="space-y-2 text-xs text-text-secondary">
                <div>
                  <span className="text-text-primary">ID:</span> {detail.id}
                </div>
                {detail.match ? (
                  <div>
                    <span className="text-text-primary">Match:</span>{" "}
                    {JSON.stringify(detail.match)}
                  </div>
                ) : null}
                <div>
                  <span className="text-text-primary">Actions:</span>{" "}
                  {detail.actions.length === 0
                    ? "none"
                    : detail.actions.map((a) => a.display_name).join(", ")}
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-secondary">Loading...</div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}
