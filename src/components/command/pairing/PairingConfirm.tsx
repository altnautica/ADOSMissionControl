"use client";

/**
 * @module PairingConfirm
 * @description Waiting state. Shows the 6-char code, install command,
 * countdown timer, and any agents discovered on the local network. The
 * operator either runs the install snippet on the agent or taps a discovered
 * agent to confirm.
 * @license GPL-3.0-only
 */

import { Check, Copy, Loader2, Terminal, Cpu, Wifi } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DiscoveredAgent } from "@/stores/pairing-store";

interface Props {
  code: string;
  secondsLeft: number;
  copiedCode: boolean;
  copiedInstall: boolean;
  installCommand: string;
  discoveredAgents: DiscoveredAgent[];
  onCopyCode: () => void;
  onCopyInstall: () => void;
  onDiscoveredPair: (agent: DiscoveredAgent) => void;
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PairingConfirm({
  code,
  secondsLeft,
  copiedCode,
  copiedInstall,
  installCommand,
  discoveredAgents,
  onCopyCode,
  onCopyInstall,
  onDiscoveredPair,
}: Props) {
  const t = useTranslations("command");

  return (
    <>
      {/* Hero code */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-1">
          {code.split("").map((char, i) => (
            <span
              key={i}
              className="inline-flex items-center justify-center w-10 h-12 bg-bg-primary border border-border-default rounded text-xl font-mono font-bold text-text-primary"
            >
              {char}
            </span>
          ))}
          <button
            onClick={onCopyCode}
            className="ml-2 p-2 text-text-tertiary hover:text-text-primary transition-colors"
            title={t("copyCode")}
          >
            {copiedCode ? (
              <Check size={14} className="text-status-success" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
        <p className="text-xs text-text-tertiary">
          {t("expiresIn")}{" "}
          <span
            className={
              secondsLeft < 60
                ? "text-status-warning font-medium"
                : "font-medium text-text-secondary"
            }
          >
            {formatTime(secondsLeft)}
          </span>
        </p>
      </div>

      {/* Install command */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-accent-primary" />
          <p className="text-xs font-medium text-text-primary">
            {t("firstTime")}
          </p>
        </div>

        <div className="flex items-start gap-2 p-3 bg-bg-primary border border-border-default rounded-lg">
          <code className="flex-1 text-[11px] font-mono text-text-secondary leading-relaxed break-all select-all">
            {installCommand}
          </code>
          <button
            onClick={onCopyInstall}
            className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors shrink-0"
            title={t("copyInstallCommand")}
          >
            {copiedInstall ? (
              <Check size={14} className="text-status-success" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>

        <p className="text-[10px] text-text-tertiary">
          {t("alreadyInstalledRepair")}
        </p>
      </div>

      {/* Pending → connected progress. The agent runs the install / pair
          command, beacons to the cloud relay, and only THEN does the drone
          appear in the fleet (CloudDroneBridge). We surface that as a clear
          two-step pending state so the operator sees progress and we never
          claim "paired" before the drone actually shows up. */}
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-status-success" />
          <p className="text-xs text-text-secondary">Code generated</p>
        </div>
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-accent-primary" />
          <p className="text-xs text-text-tertiary">
            {t("waitingForNode")}
          </p>
        </div>
      </div>

      {/* Discovered agents */}
      {discoveredAgents.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
            {t("discoveredOnNetwork")}
          </p>
          <div className="space-y-2">
            {discoveredAgents.map((agent) => (
              <button
                key={agent.deviceId}
                onClick={() => onDiscoveredPair(agent)}
                className="w-full flex items-center gap-3 p-3 bg-bg-primary border border-border-default rounded hover:border-accent-primary/50 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded bg-accent-primary/10 flex items-center justify-center shrink-0">
                  <Cpu size={14} className="text-accent-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-primary truncate">
                      {agent.name}
                    </span>
                    <span className="text-[10px] text-text-tertiary">
                      {agent.board}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Wifi size={10} className="text-status-success" />
                    <span className="text-[10px] text-text-tertiary font-mono">
                      {agent.pairingCode}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-medium text-accent-primary opacity-0 group-hover:opacity-100 transition-opacity">
                  {t("pair")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
