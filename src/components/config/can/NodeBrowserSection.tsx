"use client";

/**
 * @module NodeBrowserSection
 * @description DroneCAN node browser. Reads from the DroneCAN node store
 * and lists every node by ID with name, hardware/software version,
 * state, uptime and a health pill.
 *
 * A row click opens a slide-over panel that shows the recent NodeStatus
 * history. Per-node parameter editing is deferred to the next release;
 * the slide-over carries a placeholder for that surface.
 *
 * The auto-refresh toggle enables/disables the live store read.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { EyeOff, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { useDroneCanNodeStore, type NodeEntry } from "@/stores/dronecan/node-store";

function formatUptime(sec: number | undefined): string {
  if (!sec || sec <= 0) return "—";
  const days = Math.floor(sec / 86400);
  const hrs = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${seconds}s`;
  return `${seconds}s`;
}

function formatVersion(maj: number | undefined, min: number | undefined): string {
  if (maj === undefined && min === undefined) return "—";
  return `${maj ?? 0}.${min ?? 0}`;
}

function healthPillClass(health: number | undefined): string {
  if (health === undefined) return "bg-bg-tertiary text-text-tertiary";
  if (health === 0) return "bg-status-success/20 text-status-success";
  if (health === 1) return "bg-status-warning/20 text-status-warning";
  return "bg-status-error/20 text-status-error";
}

function modeLabel(mode: number | undefined): string {
  switch (mode) {
    case 0: return "OPERATIONAL";
    case 1: return "INITIALIZATION";
    case 2: return "MAINTENANCE";
    case 3: return "SOFTWARE_UPDATE";
    case 7: return "OFFLINE";
    default: return mode === undefined ? "—" : String(mode);
  }
}

interface NodeDetailDrawerProps {
  node: NodeEntry | null;
  onClose: () => void;
}

function NodeDetailDrawer({ node, onClose }: NodeDetailDrawerProps) {
  const t = useTranslations("canConfig.nodeBrowser");
  const placeholder = useTranslations("canConfig.placeholder");

  if (!node) return null;

  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="flex-1 bg-bg-primary/60" onClick={onClose} />
      <aside className="w-[420px] h-full bg-bg-secondary border-l border-border-default flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t("detailTitle")} {node.nodeId}
            </h3>
            <p className="text-[11px] text-text-tertiary">
              {node.nodeInfo?.name ?? "—"}
            </p>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Card>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                {t("recentStatus")}
              </h4>
              {node.statusHistory.length === 0 ? (
                <p className="text-xs text-text-tertiary">{t("noStatusYet")}</p>
              ) : (
                <ul className="space-y-1 font-mono text-[10px] text-text-secondary max-h-72 overflow-y-auto">
                  {node.statusHistory.slice(-30).reverse().map((status, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 border-b border-border-default last:border-b-0 py-0.5">
                      <span>uptime {status.uptime_sec ?? "—"}s</span>
                      <span>health {status.health ?? "—"}</span>
                      <span>mode {status.mode ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <p className="text-xs text-text-tertiary">{placeholder("comingNext")}</p>
          </Card>
        </div>
      </aside>
    </div>
  );
}

interface NodeBrowserSectionProps {
  /**
   * Invoked when a row is clicked. When omitted the section opens its
   * own slide-over detail drawer (the legacy standalone behaviour).
   */
  onSelectNode?: (nodeId: number) => void;
}

export function NodeBrowserSection({ onSelectNode }: NodeBrowserSectionProps = {}) {
  const t = useTranslations("canConfig.nodeBrowser");
  const tCol = useTranslations("canConfig.nodeBrowser.column");

  // Subscribe to the version counter so the table updates on every
  // mutation rather than just on a fresh subscription.
  const version = useDroneCanNodeStore((s) => s._version);
  const nodesMap = useDroneCanNodeStore((s) => s.nodes);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  // Snapshot the node list. The version counter forces a re-render on
  // mutation, but the rendered rows hold whatever was in the map at
  // subscription time.
  const rows = useMemo(() => {
    if (!autoRefresh) return [] as NodeEntry[];
    const all = Array.from(nodesMap.values());
    all.sort((a, b) => a.nodeId - b.nodeId);
    return all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesMap, version, autoRefresh]);

  const selectedNode = selectedNodeId !== null ? (nodesMap.get(selectedNodeId) ?? null) : null;
  // GCS audit Step 8: removed the three deferred roadmap stubs that shipped
  // no real behaviour — the hardcoded id-conflict count (conflictCount = 0),
  // the no-op DroneCAN rescan button, and the unconsumed anonymous-discovery
  // toggle. Clean cutover: no dead UI left behind. Wiring any of
  // these to the store/protocol is a separate feature task, not done here.

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-text-primary">{t("title")}</h3>
          <div className="flex flex-wrap items-center gap-4">
            <Toggle label={t("autoRefresh")} checked={autoRefresh} onChange={setAutoRefresh} />
          </div>
        </div>
      </Card>

      <Card padding={false}>
        {rows.length === 0 ? (
          <div className="text-center py-12">
            <EyeOff size={20} className="mx-auto text-text-tertiary mb-2" />
            <p className="text-xs text-text-tertiary">{t("noNodes")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-tertiary border-b border-border-default text-text-tertiary">
                <tr>
                  <th className="text-left py-1.5 px-3 font-medium">{tCol("id")}</th>
                  <th className="text-left py-1.5 pr-3 font-medium">{tCol("name")}</th>
                  <th className="text-left py-1.5 pr-3 font-medium">{tCol("hwVersion")}</th>
                  <th className="text-left py-1.5 pr-3 font-medium">{tCol("swVersion")}</th>
                  <th className="text-left py-1.5 pr-3 font-medium">{tCol("state")}</th>
                  <th className="text-left py-1.5 pr-3 font-medium">{tCol("uptime")}</th>
                  <th className="text-left py-1.5 pr-3 font-medium">{tCol("health")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => {
                  const name = entry.nodeInfo?.name ?? "—";
                  const hwVersion = formatVersion(
                    entry.nodeInfo?.hardware_version?.major,
                    entry.nodeInfo?.hardware_version?.minor,
                  );
                  const swVersion = formatVersion(
                    entry.nodeInfo?.software_version?.major,
                    entry.nodeInfo?.software_version?.minor,
                  );
                  const status = entry.lastStatus;
                  return (
                    <tr
                      key={entry.nodeId}
                      className="border-b border-border-default last:border-b-0 hover:bg-bg-primary/40 cursor-pointer"
                      onClick={() => {
                        if (onSelectNode) onSelectNode(entry.nodeId);
                        else setSelectedNodeId(entry.nodeId);
                      }}
                    >
                      <td className="py-1.5 px-3 font-mono text-accent-primary">{entry.nodeId}</td>
                      <td className="py-1.5 pr-3 text-text-primary">{name}</td>
                      <td className="py-1.5 pr-3 font-mono text-text-secondary">{hwVersion}</td>
                      <td className="py-1.5 pr-3 font-mono text-text-secondary">{swVersion}</td>
                      <td className="py-1.5 pr-3 font-mono text-text-secondary">{modeLabel(status?.mode)}</td>
                      <td className="py-1.5 pr-3 font-mono text-text-secondary">{formatUptime(status?.uptime_sec)}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${healthPillClass(status?.health)}`}>
                          {status?.health ?? "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedNode && <NodeDetailDrawer node={selectedNode} onClose={() => setSelectedNodeId(null)} />}
    </div>
  );
}
