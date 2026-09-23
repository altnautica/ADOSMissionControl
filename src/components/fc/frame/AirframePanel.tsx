"use client";

import { useState, useMemo } from "react";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useDroneManager } from "@/stores/drone-manager";
import { useToast } from "@/components/ui/toast";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedWarningBanner } from "@/components/indicators/ArmedWarningBanner";
import { PanelHeader } from "../shared/PanelHeader";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Box, Save, HardDrive, AlertTriangle, Search } from "lucide-react";

// ── PX4 airframe database (common airframes) ────────────────

interface AirframeEntry {
  id: number;
  name: string;
  category: string;
}

const PX4_AIRFRAMES: AirframeEntry[] = [
  // Multirotor
  { id: 4001, name: "Generic Quadrotor X", category: "Quadrotor X" },
  { id: 4010, name: "DJI F330", category: "Quadrotor X" },
  { id: 4011, name: "DJI F450", category: "Quadrotor X" },
  { id: 4014, name: "S500 Generic", category: "Quadrotor X" },
  { id: 4015, name: "Holybro S500", category: "Quadrotor X" },
  { id: 4016, name: "Holybro QAV250", category: "Quadrotor X" },
  { id: 4017, name: "NXP HoverGames", category: "Quadrotor X" },
  { id: 4019, name: "Holybro X500", category: "Quadrotor X" },
  { id: 4020, name: "Holybro X500 V2", category: "Quadrotor X" },
  { id: 4030, name: "Generic Quadrotor +", category: "Quadrotor +" },
  { id: 4040, name: "Reaper 500 Quad", category: "Quadrotor X" },
  { id: 6001, name: "Generic Hexarotor X", category: "Hexarotor X" },
  { id: 6002, name: "Generic Hexarotor +", category: "Hexarotor +" },
  { id: 8001, name: "Generic Octorotor X", category: "Octorotor X" },
  { id: 8002, name: "Generic Octorotor +", category: "Octorotor +" },
  { id: 12001, name: "Generic Helicopter", category: "Helicopter" },
  // Fixed Wing
  { id: 2100, name: "Standard Plane", category: "Standard Plane" },
  { id: 2106, name: "Bormatec Nebula", category: "Standard Plane" },
  { id: 2200, name: "Standard VTOL", category: "Standard VTOL" },
  { id: 3000, name: "Generic Flying Wing", category: "Flying Wing" },
  { id: 3033, name: "Wing Wing Z-84", category: "Flying Wing" },
  { id: 3034, name: "FX-79 Buffalo", category: "Flying Wing" },
  // VTOL
  { id: 13000, name: "Generic QuadPlane VTOL", category: "VTOL QuadPlane" },
  { id: 13001, name: "Fun Cub QuadPlane", category: "VTOL QuadPlane" },
  { id: 13003, name: "Convergence VTOL", category: "VTOL Tiltrotor" },
  { id: 13004, name: "Deltaquad", category: "VTOL QuadPlane" },
  // Ground
  { id: 50000, name: "Generic Ground Vehicle", category: "Rover" },
  { id: 50003, name: "Aion R1 Rover", category: "Rover" },
];

const CATEGORIES = [...new Set(PX4_AIRFRAMES.map(a => a.category))];

const AIRFRAME_PARAMS = ["SYS_AUTOSTART", "SYS_AUTOCONFIG"];

export function AirframePanel() {
  const getSelectedProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const {
    params, loading, error, dirtyParams, hasRamWrites,
    loadProgress, hasLoaded,
    refresh, setLocalValue, saveAllToRam, commitToFlash,
  } = usePanelParams({ paramNames: AIRFRAME_PARAMS, panelId: "airframe", autoLoad: true });
  useUnsavedGuard(dirtyParams.size > 0);

  const connected = !!getSelectedProtocol();
  const hasDirty = dirtyParams.size > 0;
  const currentAirframe = params.get("SYS_AUTOSTART") ?? 0;

  const filteredAirframes = useMemo(() => {
    let list = PX4_AIRFRAMES;
    if (selectedCategory) {
      list = list.filter(a => a.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        String(a.id).includes(q)
      );
    }
    return list;
  }, [selectedCategory, searchQuery]);

  const currentEntry = PX4_AIRFRAMES.find(a => a.id === currentAirframe);

  function selectAirframe(id: number) {
    setLocalValue("SYS_AUTOSTART", id);
    setLocalValue("SYS_AUTOCONFIG", 1);
  }

  async function handleSave() {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast("Airframe saved. Reboot required to apply.", "success");
    else toast("Failed to save airframe", "error");
  }

  async function handleFlash() {
    const ok = await commitToFlash();
    showFlashResult(ok, { successMessage: "Written to flash" });
  }

  return (
    <ArmedWarningBanner>
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl space-y-6">
        <PanelHeader
          icon={<Box size={16} />}
          title="Airframe Selection"
          subtitle="PX4 airframe configuration (SYS_AUTOSTART)"
          loading={loading}
          loadProgress={loadProgress}
          hasLoaded={hasLoaded}
          error={error}
          onRead={refresh}
          connected={connected}
        />

        {/* Current airframe */}
        {hasLoaded && (
          <div className="p-4 rounded-lg bg-bg-tertiary border border-border-default">
            <div className="text-xs text-text-tertiary mb-1">Current Airframe</div>
            <div className="text-sm font-medium text-text-primary">
              {currentEntry ? `${currentEntry.name} (${currentEntry.id})` : `Custom (${currentAirframe})`}
            </div>
            {currentEntry && (
              <div className="text-xs text-text-tertiary mt-1">{currentEntry.category}</div>
            )}
          </div>
        )}

        {/* Reboot warning */}
        {hasDirty && (
          <div className="flex items-center gap-2 px-3 py-2 bg-status-warning/10 rounded-md text-xs text-status-warning">
            <AlertTriangle size={14} className="shrink-0" />
            <span>Changing airframe requires a reboot. All parameters will reset to airframe defaults.</span>
          </div>
        )}

        {/* Search & filter */}
        {hasLoaded && (
          <>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-text-tertiary" />
                <Input
                  placeholder="Search airframes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 text-xs pl-8"
                />
              </div>
              <Select
                value={selectedCategory ?? ""}
                onChange={(v) => setSelectedCategory(v || null)}
                options={[
                  { value: "", label: "All Categories" },
                  ...CATEGORIES.map(c => ({ value: c, label: c })),
                ]}
              />
            </div>

            {/* Airframe grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredAirframes.map((af) => (
                <button
                  key={af.id}
                  onClick={() => selectAirframe(af.id)}
                  className={`p-3 rounded-md text-left transition-colors border ${
                    af.id === (params.get("SYS_AUTOSTART") ?? 0)
                      ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                      : af.id === currentAirframe
                        ? "border-status-success/30 bg-status-success/5 text-text-primary"
                        : "border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary"
                  }`}
                >
                  <div className="text-xs font-medium">{af.name}</div>
                  <div className="text-[10px] text-text-tertiary mt-0.5">ID: {af.id} | {af.category}</div>
                </button>
              ))}
            </div>
            {filteredAirframes.length === 0 && (
              <p className="text-xs text-text-tertiary text-center py-4">No airframes match your search.</p>
            )}

            {/* Custom ID input */}
            <div className="p-3 rounded-md bg-bg-tertiary border border-border-default">
              <label className="text-xs text-text-secondary mb-2 block">Custom Airframe ID</label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  value={String(params.get("SYS_AUTOSTART") ?? 0)}
                  onChange={(e) => selectAirframe(Number(e.target.value) || 0)}
                  className="h-8 text-xs flex-1"
                />
              </div>
            </div>
          </>
        )}

        {/* Save / Flash */}
        {hasLoaded && (
          <div className="flex gap-2 pt-2">
            <Button size="sm" disabled={!hasDirty || saving} onClick={handleSave}>
              <Save size={14} className="mr-1" /> {saving ? "Saving..." : "Save"}
            </Button>
            <Button size="sm" variant="secondary" disabled={!hasRamWrites} onClick={handleFlash}>
              <HardDrive size={14} className="mr-1" /> Write to Flash
            </Button>
          </div>
        )}
      </div>
    </div>
    </ArmedWarningBanner>
  );
}
