"use client";

/**
 * @module VideoTransportSwitcher
 * @description DEC-107 Phase H: interactive video transport pill + dropdown.
 *
 * Replaces the passive transport pill in VideoFeedCard. Lets users:
 *   - See which transport is currently active and at what latency
 *   - Pick "Auto" (cascade LAN → P2P MQTT) or pin to a specific mode
 *   - View per-mode health (green = ok, blue = testing, yellow = unknown,
 *     red = failed, gray = unavailable)
 *   - Hover failed modes for diagnostic tooltip with attempt stage + code
 *   - Trigger a retry from the failed state
 *   - Select "Off" to disable video entirely
 *
 * Cloud WHEP and Cloud MSE modes are deferred per Plan Part H — they're
 * not in the option list. The dropdown re-introduces them as soon as those
 * paths land.
 *
 * The dropdown renders inside the parent video container (containerRef
 * prop) so it stays inside fullscreen.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useVideoStore,
  type VideoTransport,
  type TransportHealth,
} from "@/stores/video-store";
import { useSettingsStore } from "@/stores/settings-store";

type TransportMode = "auto" | "lan-whep" | "p2p-mqtt" | "off";

interface Props {
  /** Active transport reported by the cascade hook */
  activeTransport: VideoTransport;
  /** Current cascade state for the pill color/spinner */
  cascadeState: "idle" | "connecting" | "connected" | "failed";
  /** Latest cascade-level error (for the footer) */
  cascadeError: string | null;
  /** Callback to bump retryKey in the parent (re-run cascade) */
  onRetry: () => void;
  /** Whether the agent has paired (enables P2P MQTT option) */
  hasPairedAgent: boolean;
  /** Whether the agent has a reachable LAN WHEP URL (enables LAN option) */
  hasLanWhep: boolean;
  /**
   * Part I P1-10: agent video service state ("running" / "starting" /
   * "stopped" / "unknown"). Surfaced in the dropdown footer when the
   * service isn't running so users know it's not a transport problem.
   */
  agentVideoState: string;
  /**
   * Part I P1-9: when > 0, the parent is in a backoff window before the
   * next auto-retry. The pill shows "Retrying in Xs" instead of flashing
   * between FAILED and CONNECTING.
   */
  retryDelaySec: number;
}

const TRANSPORT_LABELS: Record<VideoTransport, string> = {
  "lan-whep": "LAN DIRECT",
  "p2p-mqtt": "P2P MQTT",
  "cloud-whep": "CLOUD WHEP",
  "cloud-mse": "CLOUD MSE",
  "off": "OFF",
  "unknown": "—",
};

const STAGE_LABELS: Record<string, string> = {
  "starting": "starting",
  "ice-gathering": "gathering ICE candidates",
  "sdp-exchange": "exchanging SDP",
  "ontrack-wait": "waiting for video track",
  "connected": "connected",
};

function dotColorForHealth(h: TransportHealth, isActive: boolean): string {
  if (isActive && h.state === "ok") return "bg-green-400";
  if (h.state === "testing") return "bg-blue-400 animate-pulse";
  if (h.state === "ok") return "bg-green-400";
  if (h.state === "failed") return "bg-red-400";
  return "bg-yellow-400"; // unknown / not tried
}

function dotColorForUnavailable(): string {
  return "bg-gray-500";
}

function pillDotColor(
  state: Props["cascadeState"],
  transport: VideoTransport,
  agentVideoStopped: boolean,
  retryDelaySec: number,
): string {
  if (agentVideoStopped) return "bg-gray-500";
  if (retryDelaySec > 0) return "bg-orange-400 animate-pulse";
  if (state === "connecting") return "bg-blue-400 animate-pulse";
  if (state === "failed") return "bg-red-400";
  if (state === "connected") {
    if (transport === "lan-whep") return "bg-green-400";
    if (transport === "p2p-mqtt") return "bg-yellow-400";
    if (transport === "off") return "bg-gray-500";
    return "bg-blue-400";
  }
  return "bg-gray-500";
}

// Part I P2-21: keyboard nav uses option indices in this fixed order
const DROPDOWN_OPTIONS: TransportMode[] = ["auto", "lan-whep", "p2p-mqtt", "off"];

export function VideoTransportSwitcher(props: Props) {
  const {
    activeTransport,
    cascadeState,
    cascadeError,
    onRetry,
    hasPairedAgent,
    hasLanWhep,
    agentVideoState,
    retryDelaySec,
  } = props;

  const transportMode = useSettingsStore((s) => s.videoTransportMode);
  const setTransportMode = useSettingsStore((s) => s.setVideoTransportMode);
  const transportHealth = useVideoStore((s) => s.transportHealth);
  const latencyMs = useVideoStore((s) => s.latencyMs);

  const [open, setOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const pillRef = useRef<HTMLButtonElement>(null);

  const selectMode = useCallback(
    (mode: TransportMode) => {
      setTransportMode(mode);
      setOpen(false);
      // Force re-cascade so the new mode kicks in immediately
      onRetry();
    },
    [onRetry, setTransportMode],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!pillRef.current) return;
      const target = e.target as Node;
      if (pillRef.current.contains(target)) return;
      // Allow clicks inside the dropdown to bubble normally
      const dropdown = document.getElementById("video-transport-dropdown");
      if (dropdown?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Part I P2-21: keyboard nav. ESC closes, ArrowDown/Up moves focus,
  // Enter selects. Tab also closes (lets user tab past the widget).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        setOpen(false);
        if (e.key === "Escape") e.stopPropagation();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx((i) => (i + 1) % DROPDOWN_OPTIONS.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx((i) => (i - 1 + DROPDOWN_OPTIONS.length) % DROPDOWN_OPTIONS.length);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const mode = DROPDOWN_OPTIONS[focusedIdx];
        // Skip unavailable modes (LAN with no URL, P2P with no pairing)
        const available =
          mode === "auto" ||
          mode === "off" ||
          (mode === "lan-whep" && hasLanWhep) ||
          (mode === "p2p-mqtt" && hasPairedAgent);
        if (available) selectMode(mode);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, focusedIdx, hasLanWhep, hasPairedAgent, selectMode]);

  // Reset keyboard focus to current mode when dropdown opens
  useEffect(() => {
    if (open) {
      const idx = DROPDOWN_OPTIONS.indexOf(transportMode);
      setFocusedIdx(idx >= 0 ? idx : 0);
    }
  }, [open, transportMode]);

  // Part I P1-10: surface "agent video stopped" state cleanly. If the agent
  // video service isn't running, the cascade is disabled — pill should
  // reflect that instead of showing the last cascade label.
  const agentVideoStopped =
    agentVideoState !== "running" && agentVideoState !== "starting";

  // Pill label: in Auto mode show "AUTO · <current>"; pinned shows just current.
  // Part I P2-14: AUTO·FAILED variant. Part I P1-9: retrying countdown.
  const pillLabel = (() => {
    if (agentVideoStopped) return "AGENT VIDEO STOPPED";
    if (transportMode === "off" || activeTransport === "off") return "OFF";
    if (retryDelaySec > 0) return `RETRYING IN ${retryDelaySec}s`;
    if (cascadeState === "connecting") return "CONNECTING…";
    if (cascadeState === "failed") {
      if (transportMode === "auto") return "AUTO · FAILED";
      return `${TRANSPORT_LABELS[transportMode]} FAILED`;
    }
    const cur = TRANSPORT_LABELS[activeTransport];
    return transportMode === "auto" ? `AUTO · ${cur}` : cur;
  })();

  const showLatency =
    cascadeState === "connected" && latencyMs > 0 && transportMode !== "off";

  return (
    <>
      <button
        ref={pillRef}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "absolute top-2 left-2 z-20 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm",
          "text-[10px] font-mono text-text-secondary flex items-center gap-1.5",
          "hover:bg-black/80 transition-colors select-none cursor-pointer",
          "focus:outline-none focus:ring-1 focus:ring-accent-primary",
        )}
        title="Switch video transport"
        aria-label="Video transport switcher"
        aria-expanded={open}
      >
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            pillDotColor(cascadeState, activeTransport, agentVideoStopped, retryDelaySec),
          )}
        />
        <span>{pillLabel}</span>
        {showLatency && <span>· {latencyMs}ms</span>}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <DropdownPanel
          mode={transportMode}
          activeTransport={activeTransport}
          transportHealth={transportHealth}
          hasPairedAgent={hasPairedAgent}
          hasLanWhep={hasLanWhep}
          agentVideoStopped={agentVideoStopped}
          focusedIdx={focusedIdx}
          onSelect={selectMode}
          onRetry={() => {
            setOpen(false);
            onRetry();
          }}
          cascadeError={cascadeError}
        />
      )}
    </>
  );
}

interface DropdownProps {
  mode: TransportMode;
  activeTransport: VideoTransport;
  transportHealth: Record<VideoTransport, TransportHealth>;
  hasPairedAgent: boolean;
  hasLanWhep: boolean;
  agentVideoStopped: boolean;
  focusedIdx: number;
  onSelect: (mode: TransportMode) => void;
  onRetry: () => void;
  cascadeError: string | null;
}

function DropdownPanel(props: DropdownProps) {
  const {
    mode,
    activeTransport,
    transportHealth,
    hasPairedAgent,
    hasLanWhep,
    agentVideoStopped,
    focusedIdx,
    onSelect,
    onRetry,
    cascadeError,
  } = props;

  // The dropdown is positioned absolute relative to the same container the
  // pill lives in (VideoFeedCard's containerRef). Anchored to top-left so
  // it stays inside fullscreen automatically (since it's a DOM child of the
  // fullscreen element).
  return (
    <div
      id="video-transport-dropdown"
      className={cn(
        "absolute top-9 left-2 z-50 w-64 rounded bg-black/90 backdrop-blur-md",
        "border border-white/10 text-[10px] font-mono text-text-secondary",
        "shadow-2xl py-1",
      )}
      role="menu"
    >
      <Option
        label="Auto (best of LAN, P2P)"
        selected={mode === "auto"}
        active={mode === "auto"}
        available
        focused={focusedIdx === 0}
        onClick={() => onSelect("auto")}
      />
      <Divider />
      <Option
        label="LAN Direct"
        selected={mode === "lan-whep"}
        active={activeTransport === "lan-whep"}
        available={hasLanWhep}
        unavailableReason="No agent on LAN"
        health={transportHealth["lan-whep"]}
        focused={focusedIdx === 1}
        onClick={() => hasLanWhep && onSelect("lan-whep")}
      />
      <Option
        label="P2P MQTT"
        selected={mode === "p2p-mqtt"}
        active={activeTransport === "p2p-mqtt"}
        available={hasPairedAgent}
        unavailableReason="Agent not paired"
        health={transportHealth["p2p-mqtt"]}
        focused={focusedIdx === 2}
        onClick={() => hasPairedAgent && onSelect("p2p-mqtt")}
      />
      <Option
        label="Off"
        selected={mode === "off"}
        active={mode === "off"}
        available
        focused={focusedIdx === 3}
        onClick={() => onSelect("off")}
      />
      {/* Part I P1-10: agent video service status footer. Surfaces "agent
          video service stopped" so users know it's not a transport issue. */}
      {agentVideoStopped && (
        <>
          <Divider />
          <div className="px-2 py-1.5 text-orange-400 text-[10px] leading-tight">
            <div className="font-semibold mb-0.5">⚠ Agent video stopped</div>
            <div className="text-text-tertiary">
              The agent&apos;s video service is not running. Check
              <code className="px-1">ados-video</code> on the SBC.
            </div>
          </div>
        </>
      )}
      {cascadeError && !agentVideoStopped && (
        <>
          <Divider />
          <div className="px-2 py-1.5 text-red-400 text-[10px] leading-tight">
            <div className="font-semibold mb-0.5">⚠ Last attempt failed</div>
            <div className="text-text-tertiary">{cascadeError}</div>
            <button
              onClick={onRetry}
              className="mt-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-text-primary text-[10px] transition-colors"
            >
              Retry
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface OptionProps {
  label: string;
  selected: boolean;
  active: boolean;
  available: boolean;
  unavailableReason?: string;
  health?: TransportHealth;
  /** Part I P2-21: keyboard focus indicator (true = highlighted by ArrowUp/Down) */
  focused: boolean;
  onClick: () => void;
}

function Option(props: OptionProps) {
  const { label, selected, active, available, unavailableReason, health, focused, onClick } = props;
  const dotColor = !available
    ? dotColorForUnavailable()
    : health
      ? dotColorForHealth(health, active)
      : "bg-yellow-400";
  const failed = health?.state === "failed";
  const stageLabel =
    health?.lastAttemptStage && health.lastAttemptStage in STAGE_LABELS
      ? STAGE_LABELS[health.lastAttemptStage]
      : null;
  const tooltip = !available
    ? unavailableReason
    : failed
      ? `${health?.lastErrorCode ?? "error"}${stageLabel ? ` (during ${stageLabel})` : ""}: ${health?.lastError ?? "unknown"}`
      : undefined;

  return (
    <button
      onClick={onClick}
      disabled={!available}
      className={cn(
        "w-full px-2 py-1.5 flex items-center gap-2 text-left",
        "hover:bg-white/5 transition-colors",
        !available && "opacity-40 cursor-not-allowed",
        selected && "bg-white/5",
        focused && "ring-1 ring-inset ring-accent-primary/60 bg-white/10",
      )}
      title={tooltip}
      role="menuitemradio"
      aria-checked={selected}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
      <span className={cn("flex-1", active && "text-text-primary")}>{label}</span>
      {/* Part I P1-11: label this as "Connect: Xms" so users don't confuse
          it with the live RTT shown in the pill. */}
      {health?.connectMs != null && health.state === "ok" && (
        <span className="text-text-tertiary text-[9px]">Connect {health.connectMs}ms</span>
      )}
      {failed && <span className="text-red-400 text-[9px]">⚠</span>}
      {selected && <span className="text-accent-primary">●</span>}
    </button>
  );
}

function Divider() {
  return <div className="my-0.5 border-t border-white/5" />;
}
