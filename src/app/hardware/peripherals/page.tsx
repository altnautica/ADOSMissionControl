"use client";

/**
 * @module HardwarePeripheralsPage
 * @description Phase 4 Wave 3 Peripherals sub-view. Lists registered
 * peripheral plugins reported by the agent's Peripheral Manager. When no
 * plugins are registered the backend returns {peripherals: [], count: 0}
 * and we render an empty state. Manifest-driven form rendering for the
 * per-plugin config_schema is deferred to Track B.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { HardwareTabs } from "@/components/hardware/HardwareTabs";
import { Button } from "@/components/ui/button";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { PeripheralSummary } from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

const POLL_INTERVAL_MS = 5000;

export default function HardwarePeripheralsPage() {
  const t = useTranslations("hardware");

  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const peripherals = useGroundStationStore((s) => s.peripherals);
  const loadPeripherals = useGroundStationStore((s) => s.loadPeripherals);
  const loadPeripheralDetail = useGroundStationStore(
    (s) => s.loadPeripheralDetail,
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const agentUrlRef = useRef(agentUrl);
  const apiKeyRef = useRef(apiKey);
  agentUrlRef.current = agentUrl;
  apiKeyRef.current = apiKey;

  useEffect(() => {
    let cancelled = false;

    const poll = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const client = groundStationApiFromAgent(
        agentUrlRef.current,
        apiKeyRef.current,
      );
      if (!client || cancelled) return;
      void loadPeripherals(client);
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadPeripherals]);

  const onToggleRow = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const client = groundStationApiFromAgent(
      agentUrlRef.current,
      apiKeyRef.current,
    );
    if (!client) return;
    void loadPeripheralDetail(client, id);
  };

  const rows = useMemo(() => peripherals.list, [peripherals.list]);

  return (
    <div className="flex-1 overflow-auto bg-surface-primary p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
          <Link
            href="/hardware"
            className="hover:text-text-primary transition-colors"
          >
            {t("overview")}
          </Link>
          <span>/</span>
          <span>{t("peripherals.title")}</span>
        </div>
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">
          {t("peripherals.title")}
        </h1>

        <HardwareTabs />

        {peripherals.error ? (
          <div className="mb-4 rounded border border-status-error/50 bg-status-error/10 px-4 py-3 text-sm text-status-error">
            {peripherals.error}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded border border-border-primary bg-surface-secondary px-6 py-16 text-center">
            <p className="max-w-md text-sm text-text-secondary">
              {t("peripherals.emptyState")}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-border-primary">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-left text-xs uppercase text-text-secondary">
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
        className="cursor-pointer border-t border-border-primary hover:bg-surface-secondary"
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
        <tr className="border-t border-border-primary bg-surface-secondary/50">
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
                <div className="pt-2">
                  <Button variant="secondary" disabled>
                    Configure (Track B)
                  </Button>
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
