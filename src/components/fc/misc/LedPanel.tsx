"use client";

import { useCallback } from "react";
import { useFcPanelState } from "@/hooks/use-fc-panel-state";
import { useParamPanelActions } from "@/hooks/use-param-panel-actions";
import { useParamLabel } from "@/hooks/use-param-label";
import { useParamMetadataMap } from "@/hooks/use-param-metadata";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lightbulb, Save, HardDrive, Palette } from "lucide-react";
import { ParamFieldLabel } from "../parameters/ParamFieldLabel";
import { EnumSelect } from "../parameters/EnumSelect";
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

export function LedPanel() {
  const panelState = useFcPanelState({ paramNames: LED_PARAMS, panelId: "led" });
  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded, getProtocol,
    refresh, setLocalValue,
  } = panelState;
  const { saving, save: handleSave, flash: handleFlash } = useParamPanelActions(panelState);
  const { firmwareType } = useFirmwareCapabilities();
  const { label: pl } = useParamLabel();
  const metadata = useParamMetadataMap();
  const lbl = (raw: string) => <ParamFieldLabel raw={pl(raw)} metadata={metadata} />;

  const connected = !!getProtocol();
  const hasDirty = dirtyParams.size > 0;

  const ledTypes = params.get("NTF_LED_TYPES") ?? 0;
  const ledLen = params.get("NTF_LED_LEN") ?? 1;
  const brightness = params.get("NTF_LED_BRIGHT") ?? 3;
  const override = params.get("NTF_LED_OVERRIDE");
  const overrideMeta = metadata.get("NTF_LED_OVERRIDE");

  const toggleBit = useCallback((bit: number) => {
    const current = params.get("NTF_LED_TYPES") ?? 0;
    const mask = 1 << bit;
    const next = current & mask ? current & ~mask : current | mask;
    setLocalValue("NTF_LED_TYPES", next);
  }, [params, setLocalValue]);

  return (
    <ArmedWarningBanner>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          <PanelHeader
            title="LED Configuration"
            subtitle="Notification LED types, brightness, and colour source"
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

              {/* Colour source: NTF_LED_OVERRIDE selects where the LED
                  colours come from (an enum), it is not a colour value. */}
              {override !== undefined && (
                <Card icon={<Palette size={14} />} title="Colour Source" description="Where the notification LED takes its colours from">
                  <label className="text-xs text-text-secondary block mb-1">{lbl("NTF_LED_OVERRIDE — Colour Source")}</label>
                  {overrideMeta?.values && overrideMeta.values.size > 0 ? (
                    <EnumSelect
                      values={overrideMeta.values}
                      value={override}
                      onChange={(v) => setLocalValue("NTF_LED_OVERRIDE", v)}
                    />
                  ) : (
                    <Input
                      type="number"
                      step="1"
                      value={String(override)}
                      onChange={(e) => setLocalValue("NTF_LED_OVERRIDE", Math.trunc(Number(e.target.value) || 0))}
                    />
                  )}
                </Card>
              )}

              {/* LED Preview */}
              <Card icon={<Lightbulb size={14} />} title="Pattern Preview" description="Visual representation of LED strip">
                <div className="flex gap-1.5 flex-wrap py-2">
                  {Array.from({ length: Math.min(ledLen, 32) }, (_, i) => (
                    <div
                      key={i}
                      className="w-4 h-4 rounded-full border border-border-default transition-colors"
                      style={{
                        backgroundColor: brightness === 0 ? "#1a1a1a" : "#3A82FF",
                        opacity: brightness === 0 ? 0.2 : brightness === 1 ? 0.4 : brightness === 2 ? 0.7 : 1,
                        boxShadow: brightness > 0 ? `0 0 ${brightness * 3}px #3A82FF` : "none",
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
    </ArmedWarningBanner>
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
