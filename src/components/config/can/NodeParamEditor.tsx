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
 * Restart, FLASH_BOOTLOADER, node-ID change and erase can take out whatever
 * the node drives, so they are refused while the vehicle is armed and each
 * one asks for a confirmation naming the action and the node; the
 * destructive three also need the node typed in.
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useArmedLock } from "@/hooks/use-armed-lock";
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

/** Node actions that need an explicit confirmation. */
type NodeAction = "restart" | "flashBootloader" | "erase" | "changeId";

/** quickActions label key for each confirmed action. */
const ACTION_LABEL_KEY: Record<NodeAction, string> = {
  restart: "restart",
  flashBootloader: "flashBootloader",
  erase: "erase",
  changeId: "changeNodeId",
};

/** Highest node ID handed to a node: 126 and 127 stay free for tools, 127 is this GCS. */
const MAX_ASSIGNABLE_NODE_ID = 125;

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
  // A node action waiting for the operator's confirmation.
  const [pending, setPending] = useState<{ action: NodeAction; newId?: number } | null>(null);
  const { isHardBlocked, hardBlockMessage } = useArmedLock();
  const blockedTitle = isHardBlocked ? hardBlockMessage : undefined;

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

  // Runs only from the confirmation dialog, and never on an armed vehicle.
  const runAction = (action: NodeAction, newId?: number) =>
    wrap(async () => {
      if (!client || isHardBlocked) return;
      switch (action) {
        case "restart": {
          const r = await restartNode();
          setStatusMsg(r.ok ? "Restart requested" : "Restart failed");
          return;
        }
        case "flashBootloader": {
          const res = await client.paramSet(nodeId, "FLASH_BOOTLOADER", {
            tag: ValueTag.Integer,
            value: BigInt(1),
          });
          setStatusMsg(res.name === "FLASH_BOOTLOADER" ? "FLASH_BOOTLOADER=1" : "Set failed");
          return;
        }
        case "erase": {
          const r = await eraseToDefaults();
          setStatusMsg(r.ok ? "Erased to defaults" : "Erase failed");
          if (r.ok) await refresh();
          return;
        }
        case "changeId": {
          if (newId === undefined) return;
          const res = await client.paramSet(nodeId, "UAVCAN_NODE_ID", {
            tag: ValueTag.Integer,
            value: BigInt(newId),
          });
          setStatusMsg(res.name === "UAVCAN_NODE_ID" ? `Node ID set to ${newId}` : "Change failed");
          setShowChangeId(false);
          return;
        }
      }
    });

  const onReload = () =>
    wrap(async () => {
      await refresh();
      setStatusMsg("Reloaded");
    });

  // 126 and 127 are left for tools; 127 is this GCS's own node ID.
  const requestChangeId = () => {
    const n = Number.parseInt(newNodeIdStr, 10);
    if (!Number.isInteger(n) || n < 1 || n > MAX_ASSIGNABLE_NODE_ID) {
      setStatusMsg(`Node ID must be 1..${MAX_ASSIGNABLE_NODE_ID}`);
      return;
    }
    setPending({ action: "changeId", newId: n });
  };

  const onUpdateFirmware = () => {
    router.push(`/config/firmware?stack=ap-periph&target=${nodeId}`);
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
          <Button variant="ghost" size="sm" icon={<RotateCcw size={12} />} onClick={() => setPending({ action: "restart" })} disabled={!client || busy || isHardBlocked} title={blockedTitle}>
            {tQuick("restart")}
          </Button>
          <Button variant="ghost" size="sm" icon={<FlaskConical size={12} />} onClick={() => setPending({ action: "flashBootloader" })} disabled={!client || busy || isHardBlocked} title={blockedTitle}>
            {tQuick("flashBootloader")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Upload size={12} />} onClick={onUpdateFirmware} disabled={!client}>
            {tQuick("updateFirmware")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Hash size={12} />} onClick={() => setShowChangeId((v) => !v)} disabled={!client || busy || isHardBlocked} title={blockedTitle}>
            {tQuick("changeNodeId")}
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} onClick={() => setPending({ action: "erase" })} disabled={!client || busy || isHardBlocked} title={blockedTitle}>
            {tQuick("erase")}
          </Button>
        </div>

        {showChangeId && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border-default">
            <input
              type="number"
              min={1}
              max={MAX_ASSIGNABLE_NODE_ID}
              value={newNodeIdStr}
              onChange={(e) => setNewNodeIdStr(e.target.value)}
              placeholder={`1..${MAX_ASSIGNABLE_NODE_ID}`}
              className="px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded w-24 text-text-primary"
              aria-label="New node id"
            />
            <Button variant="secondary" size="sm" onClick={requestChangeId} disabled={!client || busy || isHardBlocked} title={blockedTitle}>
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
              onClick={() => setPending({ action: "erase" })}
              disabled={!client || busy || isHardBlocked}
              title={blockedTitle}
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
      <ConfirmDialog
        open={pending !== null}
        variant="danger"
        title={pending ? t(`confirm.${pending.action}Title`, { nodeId, newId: pending.newId ?? 0 }) : ""}
        message={pending ? t(`confirm.${pending.action}Message`, { nodeId, name: nodeName, newId: pending.newId ?? 0 }) : ""}
        confirmLabel={pending ? tQuick(ACTION_LABEL_KEY[pending.action]) : undefined}
        typedPhrase={pending && pending.action !== "restart" ? `node ${nodeId}` : undefined}
        confirmDisabled={isHardBlocked}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) void runAction(p.action, p.newId);
        }}
      />
    </div>
  );
}
