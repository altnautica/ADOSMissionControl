"use client";

import { useState, useMemo, useCallback } from "react";
import { useFcPanelState } from "@/hooks/use-fc-panel-state";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { useToast } from "@/components/ui/toast";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lightbulb, Save, HardDrive, Palette } from "lucide-react";
import { ParamLabel } from "../parameters/ParamLabel";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";

const LED_PARAMS = [
  "NTF_LED_TYPES", "NTF_LED_LEN", "NTF_LED_BRIGHT", "NTF_LED_OVERRIDE",
];

const LED_TYPE_BITS = [
  { bit: 0, label: "Board" },
  { bit: 1, label: "Internal Toshiba" },
  { bit: 2, label: "External Toshiba" },
  { bit: 3, label: "PCA9685" },
  { bit: 4, label: "OreoLED" },
  { bit: 5, label: "DroneCAN" },
  { bit: 6, label: "NCP5623 External" },
  { bit: 7, label: "NCP5623 Internal" },
  { bit: 8, label: "NeoPixel" },
  { bit: 9, label: "ProfiLED" },
  { bit: 10, label: "Scripting" },
];

const BRIGHTNESS_OPTIONS = ["Off", "Low", "Medium", "High"];

function overrideToHex(value: number): string {
  if (value === 0) return "#000000";
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function hexToOverride(hex: string): number {
  const clean = hex.replace("#", "");
  return parseInt(clean, 16) || 0;
}

export function LedPanel() {
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, getProtocol,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = useFcPanelState({ paramNames: LED_PARAMS, panelId: "led" });
  const { toast } = useToast();
  const { firmwareType } = useFirmwareCapabilities();
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamLabel label={pl(raw)} metadata={metadata} />;
  const [saving, setSaving] = useState(false);

  const connected = !!getProtocol();
  const hasDirty = dirtyParams.size > 0;

  const ledTypes = params.get("NTF_LED_TYPES") ?? 0;
  const ledLen = params.get("NTF_LED_LEN") ?? 1;
  const brightness = params.get("NTF_LED_BRIGHT") ?? 3;
  const override = params.get("NTF_LED_OVERRIDE") ?? 0;

  const overrideHex = useMemo(() => overrideToHex(override), [override]);

  const toggleBit = useCallback((bit: number) => {
    const current = params.get("NTF_LED_TYPES") ?? 0;
    const mask = 1 << bit;
    const next = current & mask ? current & ~mask : current | mask;
    setLocalValue("NTF_LED_TYPES", next);
  }, [params, setLocalValue]);

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Saved to flight controller", "success");
    else toast("Some parameters failed to save", "warning");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    if (ok) toast("Written to flash — persists after reboot", "success");
    else toast("Failed to write to flash", "error");
  }

  return (
    <ArmedLockOverlay>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="LED Configuration"
            subtitle="Notification LED types, brightness, and override color"
            icon={<Lightbulb size={16} />}
            loading={loading}
            loadProgress={loadProgress}
            hasLoaded={hasLoaded}
            onRead={refresh}
            connected={connected}
            error={error}
          />

          {/* Betaflight: redirect to CLI */}
          {firmwareType === 'betaflight' && hasLoaded && (
            <Card icon={<Lightbulb size={14} />} title="Betaflight LED Strip" description="LED strip configuration for Betaflight">
              <p className="text-xs text-text-secondary">
                Betaflight LED strip uses packed position/function/color bitmasks that are best configured through the CLI.
              </p>
              <p className="text-xs text-text-tertiary">
                Use the <span className="font-mono text-accent-primary">led</span> command in the FC Console panel to configure LED strip assignments.
              </p>
              <div className="bg-bg-tertiary px-3 py-2 font-mono text-[10px] text-text-secondary space-y-1">
                <p><span className="text-accent-primary">led</span> — Show current LED strip configuration</p>
                <p><span className="text-accent-primary">led 0 0,0::C:0</span> — Example: set LED 0</p>
                <p><span className="text-accent-primary">color</span> — Show/set LED colors</p>
              </div>
            </Card>
          )}

          {/* LED Types (ArduPilot / PX4) */}
          {firmwareType !== 'betaflight' && (
            <>
              <Card icon={<Lightbulb size={14} />} title="LED Types" description="Select enabled LED hardware (bitmask)">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {LED_TYPE_BITS.map(({ bit, label }) => {
                    const checked = (ledTypes & (1 << bit)) !== 0;
                    return (
                      <label key={bit} className="flex items-center gap-2 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBit(bit)}
                          className="w-3.5 h-3.5 rounded border-border-default bg-bg-tertiary accent-accent-primary"
                        />
                        <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                          {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 text-[10px] text-text-tertiary font-mono">
                  Bitmask: {ledTypes} (0x{ledTypes.toString(16).toUpperCase()})
                </div>
              </Card>

              {/* Strip Length & Brightness */}
              <Card icon={<Lightbulb size={14} />} title="Strip Settings" description="LED count and brightness level">
                <Input
                  label={lbl("NTF_LED_LEN — Strip Length")}
                  type="number"
                  step="1"
                  min="1"
                  max="64"
                  unit="LEDs"
                  value={String(ledLen)}
                  onChange={(e) => setLocalValue("NTF_LED_LEN", Number(e.target.value) || 1)}
                />
                <div>
                  <label className="text-xs text-text-secondary block mb-2">{pl("NTF_LED_BRIGHT — Brightness")}</label>
                  <div className="flex gap-2">
                    {BRIGHTNESS_OPTIONS.map((label, i) => (
                      <button
                        key={i}
                        onClick={() => setLocalValue("NTF_LED_BRIGHT", i)}
                        className={`flex-1 py-1.5 text-xs rounded border transition-colors ${
                          brightness === i
                            ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                            : "border-border-default bg-bg-tertiary text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>

              {/* Override Color */}
              <Card icon={<Palette size={14} />} title="Override Color" description="Set a static override color (0 = disabled)">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded border border-border-default shrink-0"
                    style={{ backgroundColor: override === 0 ? "transparent" : overrideHex }}
                  />
                  <input
                    type="color"
                    value={overrideHex}
                    onChange={(e) => setLocalValue("NTF_LED_OVERRIDE", hexToOverride(e.target.value))}
                    className="w-10 h-10 cursor-pointer bg-transparent border-0 p-0"
                  />
                  <div className="flex-1">
                    <input
                      type="text"
                      value={override === 0 ? "" : overrideHex.toUpperCase()}
                      placeholder="Disabled (0)"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || val === "0") {
                          setLocalValue("NTF_LED_OVERRIDE", 0);
                        } else {
                          setLocalValue("NTF_LED_OVERRIDE", hexToOverride(val));
                        }
                      }}
                      className="w-full px-2 py-1 text-xs font-mono bg-bg-tertiary border border-border-default rounded"
                    />
                    <span className="text-[9px] text-text-tertiary">Hex RGB (set to 0 to disable)</span>
                  </div>
                </div>
              </Card>

              {/* LED Preview */}
              <Card icon={<Lightbulb size={14} />} title="Pattern Preview" description="Visual representation of LED strip">
                <div className="flex gap-1.5 flex-wrap py-2">
                  {Array.from({ length: Math.min(ledLen, 32) }, (_, i) => (
                    <div
                      key={i}
                      className="w-4 h-4 rounded-full border border-border-default transition-colors"
                      style={{
                        backgroundColor: override !== 0 ? overrideHex : brightness === 0 ? "#1a1a1a" : "#3A82FF",
                        opacity: brightness === 0 ? 0.2 : brightness === 1 ? 0.4 : brightness === 2 ? 0.7 : 1,
                        boxShadow: brightness > 0 && override !== 0
                          ? `0 0 ${brightness * 3}px ${overrideHex}`
                          : brightness > 0
                            ? `0 0 ${brightness * 3}px #3A82FF`
                            : "none",
                      }}
                    />
                  ))}
                  {ledLen > 32 && (
                    <span className="text-[10px] text-text-tertiary self-center ml-1">+{ledLen - 32} more</span>
                  )}
                </div>
              </Card>
            </>
          )}

          {/* Save */}
          <div className="flex items-center gap-3 pt-2 pb-4">
            <Button
              variant="primary"
              size="lg"
              icon={<Save size={14} />}
              disabled={!hasDirty || !connected}
              loading={saving}
              onClick={handleSave}
            >
              Save to Flight Controller
            </Button>
            {hasRamWrites && (
              <Button
                variant="secondary"
                size="lg"
                icon={<HardDrive size={14} />}
                onClick={handleFlash}
              >
                Write to Flash
              </Button>
            )}
            {!connected && (
              <span className="text-[10px] text-text-tertiary">Connect a drone to save parameters</span>
            )}
            {hasDirty && connected && (
              <span className="text-[10px] text-status-warning">Unsaved changes</span>
            )}
          </div>
        </div>
      </div>
    </ArmedLockOverlay>
  );
}

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-accent-primary">{icon}</span>
        <div>
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <p className="text-[10px] text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
