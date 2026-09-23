"use client";

/**
 * @module DiagnosticsSection
 * @description Bus + per-node DroneCAN diagnostics. The top row shows the
 * frames-per-second and errors-per-second seen on the CAN link, and the
 * bus-off count as "—" because no transport reports bus-off events yet.
 * Bus load is not shown: it cannot be derived from decoded-frame counts
 * without the bus bitrate and every frame on the wire. Below, the per-node table lazy-loads `GetTransportStats` from
 * each known node when its row is expanded. Stats responses are cached for
 * five seconds so the user can poke at the panel without hammering the bus.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useDroneCanBusStore } from "@/stores/dronecan/bus-store";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import type { DroneCanClient as RealDroneCanClient } from "@/lib/dronecan/client";

interface DiagnosticsClient {
  getTransportStats: RealDroneCanClient["getTransportStats"];
}

interface DiagnosticsSectionProps {
  client?: DiagnosticsClient | null;
}

interface NodeStatsEntry {
  fetchedAt: number;
  transfers: bigint;
  messages: bigint;
  errors: bigint;
  lastErr: string | null;
}

const STATS_TTL_MS = 5_000;

export function DiagnosticsSection({ client = null }: DiagnosticsSectionProps) {
  const t = useTranslations("canConfig.diagnostics");
  const tCol = useTranslations("canConfig.diagnostics.perNode.columns");

  const counters = useDroneCanBusStore((s) => s.counters);
  const _busVersion = useDroneCanBusStore((s) => s._version);
  const nodesMap = useDroneCanNodeStore((s) => s.nodes);
  const nodeVersion = useDroneCanNodeStore((s) => s._version);


  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<Map<number, NodeStatsEntry>>(new Map());
  const [pending, setPending] = useState<Set<number>>(new Set());

  const nodes = useMemo(() => {
    const list = Array.from(nodesMap.values());
    list.sort((a, b) => a.nodeId - b.nodeId);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesMap, nodeVersion]);

  const fetchStats = useCallback(
    async (nodeId: number, force = false) => {
      if (!client) return;
      const now = Date.now();
      const cached = stats.get(nodeId);
      if (!force && cached && now - cached.fetchedAt < STATS_TTL_MS) return;
      setPending((prev) => {
        if (prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
      try {
        const res = await client.getTransportStats(nodeId);
        setStats((prev) => {
          const next = new Map(prev);
          next.set(nodeId, {
            fetchedAt: Date.now(),
            transfers: res.transfer_count,
            messages: res.message_count,
            errors: res.error_count,
            lastErr: null,
          });
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStats((prev) => {
          const next = new Map(prev);
          next.set(nodeId, {
            fetchedAt: Date.now(),
            transfers: BigInt(0),
            messages: BigInt(0),
            errors: BigInt(0),
            lastErr: msg,
          });
          return next;
        });
      } finally {
        setPending((prev) => {
          if (!prev.has(nodeId)) return prev;
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    },
    [client, stats],
  );

  const toggle = useCallback(
    (nodeId: number) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [],
  );

  // Fetch stats lazily for each newly-expanded node.
  useEffect(() => {
    for (const id of expanded) {
      void fetchStats(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <div className="space-y-4">
      <Card title={t("title")}>
        <div className="grid grid-cols-3 gap-3">
          <Gauge label={t("framesPerSec")} value={String(counters.fps)} testId="diagnostics-fps" />
          <Gauge label={t("errorsPerSec")} value={String(counters.errorsPs)} testId="diagnostics-errors-ps" />
          <Gauge label={t("busOffEvents")} value="—" testId="diagnostics-bus-off" />
        </div>
      </Card>

      <Card title={t("perNode.title")} padding={false}>
        {nodes.length === 0 ? (
          <p className="px-3 py-4 text-xs text-text-tertiary text-center">—</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-bg-tertiary text-text-tertiary text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left py-1.5 px-3 font-medium w-6"></th>
                <th className="text-left py-1.5 pr-3 font-medium">{tCol("node")}</th>
                <th className="text-left py-1.5 pr-3 font-medium">{tCol("transfers")}</th>
                <th className="text-left py-1.5 pr-3 font-medium">{tCol("errors")}</th>
                <th className="text-left py-1.5 pr-3 font-medium">{tCol("lastErr")}</th>
                <th className="text-left py-1.5 pr-3 font-medium">{tCol("lastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((entry) => {
                const isOpen = expanded.has(entry.nodeId);
                const s = stats.get(entry.nodeId);
                const inflight = pending.has(entry.nodeId);
                return (
                  <tr
                    key={entry.nodeId}
                    className="border-b border-border-default last:border-b-0 hover:bg-bg-primary/40"
                  >
                    <td className="py-1.5 px-3">
                      <button
                        onClick={() => toggle(entry.nodeId)}
                        className="text-text-tertiary hover:text-text-primary"
                        aria-label="Toggle"
                      >
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-accent-primary">
                      {entry.nodeId}
                      <span className="ml-2 text-text-tertiary">
                        {entry.nodeInfo?.name ?? ""}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-text-secondary">
                      {isOpen ? (s ? String(s.transfers) : inflight ? "…" : "—") : "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-text-secondary">
                      {isOpen ? (s ? String(s.errors) : inflight ? "…" : "—") : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-status-warning">
                      {isOpen && s?.lastErr ? s.lastErr : ""}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-text-tertiary">
                      {Math.round((Date.now() - entry.lastSeen) / 1000)}s
                      {isOpen && (
                        <button
                          onClick={() => fetchStats(entry.nodeId, true)}
                          className="ml-2 text-text-tertiary hover:text-text-primary"
                          aria-label="Refresh"
                          disabled={!client}
                        >
                          <RefreshCw size={10} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Gauge({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div
      className="bg-bg-primary border border-border-default rounded p-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
        {label}
      </div>
      <div className="text-sm font-mono text-text-primary mt-0.5">{value}</div>
    </div>
  );
}
