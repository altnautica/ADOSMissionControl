"use client";

/**
 * @module DiscoveredAgentsList
 * @description Grid of LAN-discovered drone agents available for direct
 * pairing without going through the cloud code path.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Cpu, Wifi } from "lucide-react";

interface DiscoveredAgent {
  deviceId: string;
  name: string;
  board: string;
  pairingCode: string;
  mdnsHost?: string;
  localIp?: string;
}

export interface DiscoveredAgentsListProps {
  agents: DiscoveredAgent[];
  /** Fired with the agent the operator clicked. The caller decides
   * what to do — typically auto-fill the hostname input + trigger a
   * probe. */
  onSelect?: (agent: DiscoveredAgent) => void;
}

export function DiscoveredAgentsList({
  agents,
  onSelect,
}: DiscoveredAgentsListProps) {
  const tc = useTranslations("command");

  if (agents.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-medium text-text-primary flex items-center gap-2 px-1">
        <Wifi size={12} className="text-status-success" />
        {tc("discoveredOnYourNetwork")}
      </h2>
      <div className="grid grid-cols-1 gap-2">
        {agents.map((agent) => (
          <button
            key={agent.deviceId}
            onClick={() => onSelect?.(agent)}
            className="flex items-center gap-3 p-3 bg-bg-secondary border border-border-default rounded hover:border-accent-primary/40 transition-colors text-left"
          >
            <div className="w-8 h-8 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
              <Cpu size={14} className="text-accent-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-primary truncate">
                {agent.name}
              </p>
              <p className="text-[10px] text-text-tertiary truncate">
                {agent.board}
                {/* Show the address the pair will actually aim at — the
                    proxy-resolved IP when there is one — so the operator is
                    never shown one reach and paired against another. */}
                {agent.localIp || agent.mdnsHost ? (
                  <>
                    {" · "}
                    <span className="font-mono">
                      {agent.localIp || agent.mdnsHost}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
