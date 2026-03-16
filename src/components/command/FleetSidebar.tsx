"use client";

/**
 * @module FleetSidebar
 * @description Sidebar panel for managing paired ADOS drones.
 * Shows paired drones with online/offline status, provides pairing CTA,
 * and context menu for rename/unpair actions.
 * @license GPL-3.0-only
 */

import { useState, useRef, useEffect } from "react";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Unplug,
  Copy,
  Check,
  Cpu,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useMutation } from "convex/react";
import { cn } from "@/lib/utils";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdDronesApi } from "@/lib/community-api-drones";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";
import { useAgentStore } from "@/stores/agent-store";

interface FleetSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenPairing: () => void;
}

const ONLINE_THRESHOLD_MS = 90_000; // 90 seconds

function isOnline(drone: PairedDrone): boolean {
  if (!drone.lastSeen) return false;
  return Date.now() - drone.lastSeen < ONLINE_THRESHOLD_MS;
}

function tierLabel(tier?: number): string | null {
  if (!tier) return null;
  return `T${tier}`;
}

export function FleetSidebar({
  collapsed,
  onToggleCollapse,
  onOpenPairing,
}: FleetSidebarProps) {
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const selectedPairedId = usePairingStore((s) => s.selectedPairedId);
  const selectPairedDrone = usePairingStore((s) => s.selectPairedDrone);
  const removePairedDrone = usePairingStore((s) => s.removePairedDrone);
  const updatePairedDroneName = usePairingStore((s) => s.updatePairedDroneName);

  const convexAvailable = useConvexAvailable();
  // convexAvailable is stable (env-var derived, never changes between renders)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const renameDroneMutation = convexAvailable ? useMutation(cmdDronesApi.renameDrone) : null;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const unpairDroneMutation = convexAvailable ? useMutation(cmdDronesApi.unpairDrone) : null;

  const agentConnect = useAgentStore((s) => s.connect);
  const agentConnectCloud = useAgentStore((s) => s.connectCloud);
  const agentConnected = useAgentStore((s) => s.connected);

  const [contextMenu, setContextMenu] = useState<{
    droneId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [copiedIp, setCopiedIp] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  // Focus rename input
  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  function handleDroneClick(drone: PairedDrone) {
    selectPairedDrone(drone._id);
    const url = drone.mdnsHost
      ? `http://${drone.mdnsHost}:8080`
      : drone.lastIp
        ? `http://${drone.lastIp}:8080`
        : null;
    if (url) {
      agentConnect(url, drone.apiKey);
    }
  }

  function handleContextAction(action: string, drone: PairedDrone) {
    setContextMenu(null);
    switch (action) {
      case "rename":
        setRenaming(drone._id);
        setRenameValue(drone.name);
        break;
      case "unpair":
        removePairedDrone(drone._id);
        // Also delete from Convex so the reactive query removes it
        unpairDroneMutation?.({ droneId: drone._id as never }).catch(() => {});
        break;
      case "copy-ip":
        if (drone.lastIp) {
          navigator.clipboard.writeText(drone.lastIp).then(() => {
            setCopiedIp(true);
            setTimeout(() => setCopiedIp(false), 1500);
          });
        }
        break;
    }
  }

  function handleRenameSubmit(droneId: string) {
    if (renameValue.trim()) {
      updatePairedDroneName(droneId, renameValue.trim());
      // Persist rename to Convex
      renameDroneMutation?.({ droneId: droneId as never, name: renameValue.trim() }).catch(() => {});
    }
    setRenaming(null);
  }

  // Collapsed view
  if (collapsed) {
    return (
      <div className="w-12 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
        <div className="flex flex-col items-center gap-1.5 px-1 py-2 border-b border-border-default">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
            Fleet
          </span>
          <button
            onClick={onToggleCollapse}
            className="w-full aspect-square flex items-center justify-center hover:bg-bg-tertiary transition-colors cursor-pointer group"
            title="Expand fleet panel"
          >
            <ChevronRight
              size={12}
              className="text-text-tertiary group-hover:text-text-secondary transition-colors"
            />
          </button>
        </div>

        <div className="flex-1 overflow-auto flex flex-col items-center gap-1 py-1.5">
          {pairedDrones.map((drone) => (
            <button
              key={drone._id}
              onClick={() => handleDroneClick(drone)}
              className={cn(
                "w-8 h-8 rounded flex items-center justify-center relative transition-colors",
                selectedPairedId === drone._id
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "hover:bg-bg-tertiary text-text-tertiary"
              )}
              title={drone.name}
            >
              <Cpu size={14} />
              <span
                className={cn(
                  "absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full",
                  isOnline(drone) ? "bg-status-success" : "bg-text-tertiary/30"
                )}
              />
            </button>
          ))}
        </div>

        <div className="py-1.5 flex justify-center border-t border-border-default">
          <button
            onClick={onOpenPairing}
            className="w-8 h-8 rounded flex items-center justify-center text-accent-primary hover:bg-accent-primary/10 transition-colors"
            title="Pair new drone"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="w-56 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Paired Drones
        </span>
        <button
          onClick={onToggleCollapse}
          className="p-1 text-text-tertiary hover:text-text-primary transition-colors"
          title="Collapse"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Drone list */}
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {pairedDrones.length === 0 && (
          <div className="text-center py-8 space-y-3">
            <Cpu size={24} className="mx-auto text-text-tertiary/40" />
            <p className="text-xs text-text-tertiary">No drones paired</p>
            <button
              onClick={onOpenPairing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent-primary text-white rounded hover:opacity-90 transition-opacity"
            >
              <Plus size={12} />
              Pair Your First Drone
            </button>
          </div>
        )}

        {pairedDrones.map((drone) => (
          <div
            key={drone._id}
            onClick={() => handleDroneClick(drone)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ droneId: drone._id, x: e.clientX, y: e.clientY });
            }}
            className={cn(
              "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors group",
              selectedPairedId === drone._id
                ? "bg-accent-primary/10 border border-accent-primary/30"
                : "hover:bg-bg-tertiary border border-transparent"
            )}
          >
            <div className="relative shrink-0">
              <Cpu size={16} className="text-text-secondary" />
              <span
                className={cn(
                  "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-secondary",
                  isOnline(drone) ? "bg-status-success" : "bg-text-tertiary/30"
                )}
              />
            </div>

            <div className="flex-1 min-w-0">
              {renaming === drone._id ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameSubmit(drone._id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit(drone._id);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-full text-xs bg-bg-primary border border-accent-primary rounded px-1 py-0.5 text-text-primary outline-none"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <p className="text-xs font-medium text-text-primary truncate">
                    {drone.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {drone.board && (
                      <span className="text-[10px] text-text-tertiary truncate">
                        {drone.board}
                      </span>
                    )}
                    {drone.tier != null && (
                      <span className="text-[9px] px-1 py-px bg-accent-primary/10 text-accent-primary rounded font-medium">
                        {tierLabel(drone.tier)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Menu button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                setContextMenu({
                  droneId: drone._id,
                  x: rect.right,
                  y: rect.bottom,
                });
              }}
              className="p-0.5 text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary transition-all"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Pair button */}
      {pairedDrones.length > 0 && (
        <div className="px-2 py-2 border-t border-border-default">
          <button
            onClick={onOpenPairing}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-accent-primary border border-accent-primary/30 rounded hover:bg-accent-primary/10 transition-colors"
          >
            <Plus size={12} />
            Pair New Drone
          </button>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-bg-secondary border border-border-default rounded shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {(() => {
            const drone = pairedDrones.find((d) => d._id === contextMenu.droneId);
            if (!drone) return null;
            return (
              <>
                <button
                  onClick={() => handleContextAction("rename", drone)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                >
                  <Pencil size={12} />
                  Rename
                </button>
                {drone.lastIp && (
                  <button
                    onClick={() => handleContextAction("copy-ip", drone)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                  >
                    {copiedIp ? (
                      <Check size={12} className="text-status-success" />
                    ) : (
                      <Copy size={12} />
                    )}
                    Copy IP
                  </button>
                )}
                <div className="my-1 border-t border-border-default" />
                <button
                  onClick={() => handleContextAction("unpair", drone)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-status-error hover:bg-status-error/10 transition-colors"
                >
                  <Unplug size={12} />
                  Unpair
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
