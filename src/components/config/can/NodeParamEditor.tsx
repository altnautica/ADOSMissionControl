"use client";

/**
 * @module NodeParamEditor
 * @description Slide-over panel that edits a single DroneCAN node's parameter
 * table. Walks the index via `paramGet(nodeId, i)` until the response carries
 * an empty name, then renders one row per entry. Dirty rows highlight, and a
 * footer surfaces the dirty count plus action buttons (send all, save to
 * node, erase, reload). Quick actions row exposes restart / FLASH_BOOTLOADER
 * write / firmware update navigation / node-id change / erase.
 *
 * Renders inside a fixed right-edge drawer; click the backdrop or the close
 * button to dismiss. Falls back to an empty-state hint when no client is
 * connected.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { X, RotateCcw, Save, Trash2, RefreshCw, Hash, FlaskConical, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDroneCanNodeStore } from "@/stores/dronecan/node-store";
import {
  useDroneCanNodeParams,
  type DroneCanClient as DroneCanClientSubset,
} from "@/hooks/use-dronecan-node-params";
import { ValueTag } from "@/lib/dronecan/dsdl/param-getset";
import { NodeParamRow } from "./NodeParamRow";

interface NodeParamEditorProps {
  nodeId: number;
  client: DroneCanClientSubset | null;
  onClose: () => void;
}

const MODE_LABELS: Record<number, string> = {
  0: "OPERATIONAL",
  1: "INITIALIZATION",
  2: "MAINTENANCE",
  3: "SOFTWARE_UPDATE",
  7: "OFFLINE",
};

export function NodeParamEditor({ nodeId, client, onClose }: NodeParamEditorProps) {
  const t = useTranslations("canConfig.nodeParamEditor");
  const tCol = useTranslations("canConfig.nodeParamEditor.column");
  const tFoot = useTranslations("canConfig.nodeParamEditor.footer");
  const tQuick = useTranslations("canConfig.nodeParamEditor.quickActions");
  const router = useRouter();

  const node = useDroneCanNodeStore((s) => s.nodes.get(nodeId));
  const {
    params,
    loading,
    error,
    dirty,
    refresh,
    setLocal,
    saveAllDirty,
    eraseToDefaults,
    restartNode,
  } = useDroneCanNodeParams(client, nodeId);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [newNodeIdStr, setNewNodeIdStr] = useState<string>("");
  const [showChangeId, setShowChangeId] = useState(false);

  // Auto-load the first time we mount with a client. The hook depends on
  // client + nodeId; calling refresh again on every render is wasteful.
  useEffect(() => {
    if (!client) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, nodeId]);

  const rows = useMemo(() => Array.from(params.values()), [params]);
  const dirtyCount = dirty.size;

  const wrap = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      await fn();
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onSendAll = () =>
    wrap(async () => {
      const r = await saveAllDirty();
      setStatusMsg(
        r.failed === 0
          ? `Saved ${r.saved}`
          : `Saved ${r.saved}, failed ${r.failed}`,
      );
    });

  const onSaveToNode = () =>
    wrap(async () => {
      if (!client) return;
      // ExecuteOpcode SAVE is opcode 0. Use the hook's eraseToDefaults
      // sibling pathway via a direct client call to keep behaviour explicit.
      const res = await client.paramExecuteOpcode(nodeId, 0);
      setStatusMsg(res.ok ? "Saved to node" : "Save failed");
    });

  const onErase = () =>
    wrap(async () => {
      const r = await eraseToDefaults();
      setStatusMsg(r.ok ? "Erased to defaults" : "Erase failed");
      if (r.ok) await refresh();
    });

  const onReload = () =>
    wrap(async () => {
      await refresh();
      setStatusMsg("Reloaded");
    });

  const onRestart = () =>
    wrap(async () => {
      const r = await restartNode();
      setStatusMsg(r.ok ? "Restart requested" : "Restart failed");
    });

  const onFlashBootloader = () =>
    wrap(async () => {
      if (!client) return;
      const res = await client.paramSet(nodeId, "FLASH_BOOTLOADER", {
        tag: ValueTag.Integer,
        value: BigInt(1),
      });
      setStatusMsg(res.name === "FLASH_BOOTLOADER" ? "FLASH_BOOTLOADER=1" : "Set failed");
    });

  const onChangeId = () =>
    wrap(async () => {
      if (!client) return;
      const n = Number.parseInt(newNodeIdStr, 10);
      if (!Number.isInteger(n) || n < 1 || n > 127) {
        setStatusMsg("Node ID must be 1..127");
        return;
      }
      const res = await client.paramSet(nodeId, "UAVCAN_NODE_ID", {
        tag: ValueTag.Integer,
        value: BigInt(n),
      });
      setStatusMsg(res.name === "UAVCAN_NODE_ID" ? `Node ID set to ${n}` : "Change failed");
      setShowChangeId(false);
    });

  const onUpdateFirmware = () => {
    router.push(`/config/firmware?stack=ap_periph&target=${nodeId}`);
  };

  const nodeName = node?.nodeInfo?.name ?? "—";
  const modeLabel = MODE_LABELS[node?.lastStatus?.mode ?? -1] ?? "—";

  return (
    <div
      className="fixed inset-0 z-40 flex"
      role="dialog"
      aria-modal="true"
      data-testid="node-param-editor"
    >
      <div className="flex-1 bg-bg-primary/60" onClick={onClose} />
      <aside className="w-[560px] max-w-[95vw] h-full bg-bg-secondary border-l border-border-default flex flex-col">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t("title", { nodeId, name: nodeName })}
            </h3>
            <p className="text-[11px] text-text-tertiary font-mono">{modeLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        {/* Quick actions row */}
        <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-border-default">
          <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={onRestart} disabled={!client || busy}>
            {tQuick("restart")}
          </Button>
          <Button variant="ghost" size="sm" icon={<FlaskConical size={12} />} onClick={onFlashBootloader} disabled={!client || busy}>
            {tQuick("flashBootloader")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Upload size={12} />} onClick={onUpdateFirmware} disabled={!client}>
            {tQuick("updateFirmware")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Hash size={12} />} onClick={() => setShowChangeId((v) => !v)} disabled={!client || busy}>
            {tQuick("changeNodeId")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={onErase} disabled={!client || busy}>
            {tQuick("erase")}
          </Button>
        </div>

        {showChangeId && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default">
            <input
              type="number"
              min={1}
              max={127}
              value={newNodeIdStr}
              onChange={(e) => setNewNodeIdStr(e.target.value)}
              placeholder="1..127"
              className="px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded w-24 text-text-primary"
              aria-label="New node id"
            />
            <Button variant="secondary" size="sm" onClick={onChangeId} disabled={!client || busy}>
              {tQuick("changeNodeId")}
            </Button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!client ? (
            <div className="px-4 py-6 text-xs text-text-tertiary text-center">—</div>
          ) : loading && rows.length === 0 ? (
            <div className="px-4 py-6 text-xs text-text-tertiary text-center">Loading…</div>
          ) : error ? (
            <div className="px-4 py-6 text-xs text-status-error text-center" role="alert">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-6 text-xs text-text-tertiary text-center">—</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-bg-tertiary text-text-tertiary text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="text-left py-1.5 px-2 font-medium">{tCol("name")}</th>
                  <th className="text-left py-1.5 px-2 font-medium">{tCol("value")}</th>
                  <th className="text-left py-1.5 px-2 font-medium">{tCol("type")}</th>
                  <th className="text-left py-1.5 px-2 font-medium">{tCol("description")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <NodeParamRow
                    key={entry.name}
                    entry={entry}
                    onChange={(v) => setLocal(entry.name, v)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <footer className="px-4 py-2 border-t border-border-default flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span data-testid="node-param-editor-dirty-count">
              {tFoot("dirty", { count: dirtyCount })}
            </span>
            {statusMsg && (
              <span className="text-text-secondary font-mono">· {statusMsg}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={12} />}
              onClick={onReload}
              disabled={!client || busy}
            >
              {tFoot("reload")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={12} />}
              onClick={onErase}
              disabled={!client || busy}
            >
              {tFoot("erase")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Save size={12} />}
              onClick={onSaveToNode}
              disabled={!client || busy}
            >
              {tFoot("saveToNode")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={12} />}
              onClick={onSendAll}
              disabled={!client || busy || dirtyCount === 0}
              data-testid="node-param-editor-send-all"
            >
              {tFoot("sendAll")}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
