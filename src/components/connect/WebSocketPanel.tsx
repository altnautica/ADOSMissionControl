"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plug } from "lucide-react";
import { WebSocketTransport } from "@/lib/protocol/transport/websocket";
import { MAVLinkAdapter } from "@/lib/protocol/mavlink-adapter";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { randomId } from "@/lib/utils";
import { getPreset } from "@/lib/presets/presets";
import { BuildPresetPicker } from "./BuildPresetPicker";

const QUICK_PRESETS = [
  { label: "mavlink-router", url: "ws://localhost:14550" },
  { label: "SITL", url: "ws://localhost:5760" },
  { label: "Secondary", url: "ws://localhost:14555" },
];

/** Detect SITL-like URLs (ws://localhost:576*). */
function isSitlUrl(url: string): boolean {
  return /^wss?:\/\/(localhost|127\.0\.0\.1):576\d/.test(url);
}

export function WebSocketPanel({
  onConnected,
  url,
  onUrlChange,
}: {
  onConnected?: (name: string, type: "websocket", url: string) => void;
  url?: string;
  onUrlChange?: (url: string) => void;
}) {
  const [localUrl, setLocalUrl] = useState("ws://localhost:14550");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const addDrone = useDroneManager((s) => s.addDrone);

  const effectiveUrl = url ?? localUrl;

  const handleUrlChange = (next: string) => {
    setLocalUrl(next);
    onUrlChange?.(next);
  };

  const showPresetPicker = useMemo(() => isSitlUrl(effectiveUrl), [effectiveUrl]);

  async function handleConnect() {
    setError(null);
    const trimmed = effectiveUrl.trim();

    if (!trimmed) {
      setError("URL is required");
      return;
    }
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
      setError("URL must start with ws:// or wss://");
      return;
    }

    setConnecting(true);
    try {
      const transport = new WebSocketTransport();
      await transport.connect(trimmed);

      const adapter = new MAVLinkAdapter();
      const vehicleInfo = await adapter.connect(transport);
      const droneId = randomId();

      // Use preset name if available, otherwise firmware info
      const preset = selectedPresetId ? getPreset(selectedPresetId) : null;
      const droneName = preset
        ? preset.name
        : `${vehicleInfo.firmwareVersionString} (${vehicleInfo.vehicleClass})`;

      addDrone(droneId, droneName, adapter, transport, vehicleInfo, {
        type: "websocket",
        url: trimmed,
        presetId: selectedPresetId ?? undefined,
      });

      useDroneMetadataStore.getState().ensureProfile(droneId, {
        displayName: droneName,
        serial: `ALT-${droneId.toUpperCase()}`,
        enrolledAt: Date.now(),
      });

      onConnected?.(droneName, "websocket", trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Input
        label="WebSocket URL"
        value={effectiveUrl}
        onChange={(e) => {
          handleUrlChange(e.target.value);
          setError(null);
        }}
        placeholder="ws://localhost:14550"
      />

      {/* Quick-connect presets */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PRESETS.map((preset) => (
          <button
            key={preset.url}
            onClick={() => handleUrlChange(preset.url)}
            className={`px-2 py-1 text-[10px] font-mono border transition-colors cursor-pointer ${
              effectiveUrl === preset.url
                ? "border-accent-primary text-accent-primary bg-accent-primary/10"
                : "border-border-default text-text-tertiary hover:text-text-secondary hover:border-border-strong"
            }`}
          >
            {preset.label} — {preset.url.replace("ws://", "")}
          </button>
        ))}
      </div>

      {/* Build preset picker — shown when SITL URL detected */}
      {showPresetPicker && (
        <BuildPresetPicker
          selectedPresetId={selectedPresetId}
          onSelect={setSelectedPresetId}
        />
      )}

      <Button
        onClick={handleConnect}
        loading={connecting}
        icon={<Plug size={14} />}
      >
        {connecting ? "Connecting..." : "Connect"}
      </Button>

      <p className="text-[10px] text-text-tertiary">
        For UDP connections (e.g. 14550), run{" "}
        <code className="text-text-secondary">mavlink-router</code> as a
        WebSocket bridge
      </p>

      {error && <p className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
