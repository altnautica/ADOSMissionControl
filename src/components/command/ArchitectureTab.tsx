"use client";

/**
 * @module ArchitectureTab
 * @description Hardware architecture diagram tab showing the drone's SBC and connected peripherals
 * as a React Flow node-graph. Replaces the old card-based PeripheralsTab.
 * @license GPL-3.0-only
 */

import { useState, useEffect } from "react";
import { ScanLine, Loader2 } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { ArchitectureDiagram } from "./architecture/ArchitectureDiagram";

export function ArchitectureTab() {
  const connected = useAgentConnectionStore((s) => s.connected);
  const peripherals = useAgentPeripheralsStore((s) => s.peripherals);
  const scanPeripherals = useAgentPeripheralsStore((s) => s.scanPeripherals);
  const status = useAgentSystemStore((s) => s.status);
  const resources = useAgentSystemStore((s) => s.resources);

  const [scanning, setScanning] = useState(false);

  // Auto-scan on mount if no peripherals cached
  useEffect(() => {
    if (connected && peripherals.length === 0) {
      setScanning(true);
      scanPeripherals();
    }
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear scanning state when peripherals arrive
  useEffect(() => {
    if (peripherals.length > 0) {
      setScanning(false);
    }
  }, [peripherals.length]);

  async function handleScan() {
    setScanning(true);
    await scanPeripherals();
    setTimeout(() => setScanning(false), 15000);
  }

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Architecture
        </h3>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-border-default rounded hover:border-accent-primary hover:text-accent-primary text-text-secondary transition-colors disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ScanLine size={12} />
          )}
          {scanning ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {/* Diagram canvas */}
      <div className="flex-1 relative">
        {scanning && peripherals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 size={24} className="animate-spin text-accent-primary" />
            <p className="text-sm text-text-secondary">Scanning peripherals...</p>
            <p className="text-xs text-text-tertiary">Discovering USB, cameras, and modems</p>
          </div>
        ) : (
          <ArchitectureDiagram
            peripherals={peripherals}
            status={status}
            resources={resources}
          />
        )}
      </div>
    </div>
  );
}
