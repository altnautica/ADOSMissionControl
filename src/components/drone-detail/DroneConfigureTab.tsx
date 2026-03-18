"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useFcKeyboardShortcuts } from "@/hooks/use-fc-keyboard-shortcuts";
import { useFcPanelActionsStore } from "@/stores/fc-panel-actions-store";
import { useSettingsStore } from "@/stores/settings-store";
import dynamic from "next/dynamic";
import { FcDisconnectedPlaceholder } from "@/components/fc/shared/FcDisconnectedPlaceholder";
import { FlashCommitBanner } from "@/components/fc/shared/FlashCommitBanner";
import { RebootRequiredBanner } from "@/components/indicators/RebootRequiredBanner";
import { useParamSafetyStore } from "@/stores/param-safety-store";

const panelLoading = { loading: () => <div className="flex items-center justify-center h-32"><span className="text-xs text-text-tertiary">Loading panel...</span></div> };

const OutputsPanel = dynamic(() => import("@/components/fc/motors/OutputsPanel").then(m => ({ default: m.OutputsPanel })), { ssr: false, ...panelLoading });
const ReceiverPanel = dynamic(() => import("@/components/fc/receiver/ReceiverPanel").then(m => ({ default: m.ReceiverPanel })), { ssr: false, ...panelLoading });
const FlightModesPanel = dynamic(() => import("@/components/fc/flight-modes/FlightModesPanel").then(m => ({ default: m.FlightModesPanel })), { ssr: false, ...panelLoading });
const FailsafePanel = dynamic(() => import("@/components/fc/safety/FailsafePanel").then(m => ({ default: m.FailsafePanel })), { ssr: false, ...panelLoading });
const PowerPanel = dynamic(() => import("@/components/fc/power/PowerPanel").then(m => ({ default: m.PowerPanel })), { ssr: false, ...panelLoading });
const CliPanel = dynamic(() => import("@/components/fc/comms/CliPanel").then(m => ({ default: m.CliPanel })), { ssr: false, ...panelLoading });
const MavlinkShellPanel = dynamic(() => import("@/components/fc/comms/MavlinkShellPanel").then(m => ({ default: m.MavlinkShellPanel })), { ssr: false, ...panelLoading });
const PidTuningPanel = dynamic(() => import("@/components/fc/pid/PidTuningPanel").then(m => ({ default: m.PidTuningPanel })), { ssr: false, ...panelLoading });
const PortsPanel = dynamic(() => import("@/components/fc/comms/PortsPanel").then(m => ({ default: m.PortsPanel })), { ssr: false, ...panelLoading });
const MavlinkInspectorPanel = dynamic(() => import("@/components/fc/comms/MavlinkInspectorPanel").then(m => ({ default: m.MavlinkInspectorPanel })), { ssr: false, ...panelLoading });
const OsdEditorPanel = dynamic(() => import("@/components/fc/betaflight/OsdEditorPanel").then(m => ({ default: m.OsdEditorPanel })), { ssr: false, ...panelLoading });
const FirmwarePanel = dynamic(() => import("@/components/fc/firmware/FirmwarePanel").then(m => ({ default: m.FirmwarePanel })), { ssr: false, ...panelLoading });
const GeofencePanel = dynamic(() => import("@/components/fc/safety/GeofencePanel").then(m => ({ default: m.GeofencePanel })), { ssr: false, ...panelLoading });
const FramePanel = dynamic(() => import("@/components/fc/frame/FramePanel").then(m => ({ default: m.FramePanel })), { ssr: false, ...panelLoading });
const AirframePanel = dynamic(() => import("@/components/fc/frame/AirframePanel").then(m => ({ default: m.AirframePanel })), { ssr: false, ...panelLoading });
const ActuatorPanel = dynamic(() => import("@/components/fc/frame/ActuatorPanel").then(m => ({ default: m.ActuatorPanel })), { ssr: false, ...panelLoading });
const PreArmPanel = dynamic(() => import("@/components/fc/safety/PreArmPanel").then(m => ({ default: m.PreArmPanel })), { ssr: false, ...panelLoading });
const DebugPanel = dynamic(() => import("@/components/fc/misc/DebugPanel").then(m => ({ default: m.DebugPanel })), { ssr: false, ...panelLoading });
const DiagnosticsPanel = dynamic(() => import("@/components/diagnostics/DiagnosticsPanel").then(m => ({ default: m.DiagnosticsPanel })), { ssr: false, ...panelLoading });
const LogAnalysisPanel = dynamic(() => import("@/components/logs/LogAnalysisPanel").then(m => ({ default: m.LogAnalysisPanel })), { ssr: false, ...panelLoading });
const SensorGraphPanel = dynamic(() => import("@/components/fc/sensors/SensorGraphPanel").then(m => ({ default: m.SensorGraphPanel })), { ssr: false, ...panelLoading });
const SensorsPanel = dynamic(() => import("@/components/fc/sensors/SensorsPanel").then(m => ({ default: m.SensorsPanel })), { ssr: false, ...panelLoading });
const GimbalPanel = dynamic(() => import("@/components/fc/gimbal/GimbalPanel").then(m => ({ default: m.GimbalPanel })), { ssr: false, ...panelLoading });
const CameraPanel = dynamic(() => import("@/components/fc/gimbal/CameraPanel").then(m => ({ default: m.CameraPanel })), { ssr: false, ...panelLoading });
const LedPanel = dynamic(() => import("@/components/fc/misc/LedPanel").then(m => ({ default: m.LedPanel })), { ssr: false, ...panelLoading });
const TelRadioPanel = dynamic(() => import("@/components/fc/comms/TelRadioPanel").then(m => ({ default: m.TelRadioPanel })), { ssr: false, ...panelLoading });
// Betaflight-specific panels
const AuxModesPanel = dynamic(() => import("@/components/fc/betaflight/AuxModesPanel").then(m => ({ default: m.AuxModesPanel })), { ssr: false, ...panelLoading });
const BetaflightConfigPanel = dynamic(() => import("@/components/fc/betaflight/BetaflightConfigPanel").then(m => ({ default: m.BetaflightConfigPanel })), { ssr: false, ...panelLoading });
const BfMotorsPanel = dynamic(() => import("@/components/fc/motors/BfMotorsPanel").then(m => ({ default: m.BfMotorsPanel })), { ssr: false, ...panelLoading });
const VtxPanel = dynamic(() => import("@/components/fc/misc/VtxPanel").then(m => ({ default: m.VtxPanel })), { ssr: false, ...panelLoading });
const GpsPanel = dynamic(() => import("@/components/fc/sensors/GpsPanel").then(m => ({ default: m.GpsPanel })), { ssr: false, ...panelLoading });
const BlackboxPanel = dynamic(() => import("@/components/fc/comms/BlackboxPanel").then(m => ({ default: m.BlackboxPanel })), { ssr: false, ...panelLoading });
const RateProfilePanel = dynamic(() => import("@/components/fc/betaflight/RateProfilePanel").then(m => ({ default: m.RateProfilePanel })), { ssr: false, ...panelLoading });
const AdjustmentsPanel = dynamic(() => import("@/components/fc/betaflight/AdjustmentsPanel").then(m => ({ default: m.AdjustmentsPanel })), { ssr: false, ...panelLoading });
import type { ReactNode } from "react";
import type { ProtocolCapabilities } from "@/lib/protocol/types";
import {
  Cpu,
  Radio,
  SlidersHorizontal,
  ShieldAlert,
  Battery,
  Terminal,
  Activity,
  Cable,
  Monitor,
  Zap,
  Layers,
  Box,
  Shield,
  HeartPulse,
  Gauge,
  Move3d,
  Camera,
  BarChart3,
  Lightbulb,
  Wifi,
  Bug,
  Stethoscope,
  ToggleLeft,
  MapPin,
  Sliders,
  Settings,
  HardDrive,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Nav item type with capability gating and sections
// ---------------------------------------------------------------------------

interface FcNavItem {
  id: string;
  label: string;
  icon: ReactNode;
  requiredCapability?: keyof ProtocolCapabilities;
  section?: string;
  labelOverride?: Partial<Record<string, string>>;
}

const FC_NAV_ITEMS: FcNavItem[] = [
  // --- Flight ---
  { id: "outputs", label: "Outputs", icon: <Cpu size={14} />, section: "Flight", labelOverride: { px4: "Actuators" } },
  { id: "receiver", label: "Receiver", icon: <Radio size={14} />, requiredCapability: "supportsReceiver", section: "Flight" },
  { id: "modes", label: "Flight Modes", icon: <SlidersHorizontal size={14} />, requiredCapability: "supportsFlightModes", section: "Flight" },
  { id: "aux-modes", label: "Aux Modes", icon: <ToggleLeft size={14} />, requiredCapability: "supportsAuxModes", section: "Flight" },
  { id: "bf-motors", label: "Motors & ESC", icon: <Cpu size={14} />, requiredCapability: "supportsBetaflightConfig", section: "Flight" },
  { id: "frame", label: "Frame", icon: <Box size={14} />, section: "Flight", labelOverride: { px4: "Airframe" } },
  // --- Safety ---
  { id: "failsafe", label: "Failsafe", icon: <ShieldAlert size={14} />, requiredCapability: "supportsFailsafe", section: "Safety" },
  { id: "geofence", label: "Geofence", icon: <Shield size={14} />, requiredCapability: "supportsGeoFence", section: "Safety" },
  { id: "health", label: "Health Check", icon: <HeartPulse size={14} />, section: "Safety" },
  // --- Sensors ---
  { id: "sensors", label: "Sensors", icon: <Gauge size={14} />, section: "Sensors" },
  { id: "power", label: "Power", icon: <Battery size={14} />, requiredCapability: "supportsPowerConfig", section: "Sensors" },
  { id: "gps-config", label: "GPS", icon: <MapPin size={14} />, requiredCapability: "supportsGpsConfig", section: "Sensors" },
  { id: "gimbal", label: "Gimbal", icon: <Move3d size={14} />, requiredCapability: "supportsGimbal", section: "Sensors" },
  { id: "camera", label: "Camera", icon: <Camera size={14} />, requiredCapability: "supportsCamera", section: "Sensors" },
  // --- Tuning ---
  { id: "pid", label: "PID Tuning", icon: <Activity size={14} />, requiredCapability: "supportsPidTuning", section: "Tuning" },
  { id: "rate-profiles", label: "Rate Profiles", icon: <Activity size={14} />, requiredCapability: "supportsRateProfiles", section: "Tuning" },
  { id: "adjustments", label: "Adjustments", icon: <Sliders size={14} />, requiredCapability: "supportsAdjustments", section: "Tuning" },
  { id: "sensor-graphs", label: "Sensor Graphs", icon: <BarChart3 size={14} />, section: "Tuning" },
  // --- Display ---
  { id: "osd", label: "OSD Editor", icon: <Layers size={14} />, requiredCapability: "supportsOsd", section: "Display" },
  { id: "led", label: "LED Strip", icon: <Lightbulb size={14} />, requiredCapability: "supportsLed", section: "Display" },
  { id: "vtx", label: "VTX", icon: <Radio size={14} />, requiredCapability: "supportsVtx", section: "Display" },
  // --- System ---
  { id: "ports", label: "Ports", icon: <Cable size={14} />, requiredCapability: "supportsPorts", section: "System" },
  { id: "radio", label: "Radio Config", icon: <Wifi size={14} />, section: "System" },
  { id: "bf-config", label: "Configuration", icon: <Settings size={14} />, requiredCapability: "supportsBetaflightConfig", section: "System" },
  { id: "firmware", label: "Firmware", icon: <Zap size={14} />, requiredCapability: "supportsFirmwareFlash", section: "System" },
  { id: "cli", label: "CLI", icon: <Terminal size={14} />, requiredCapability: "supportsCliShell", section: "System", labelOverride: { px4: "Shell" } },
  // --- Debug ---
  { id: "mavlink", label: "MAVLink Inspector", icon: <Monitor size={14} />, requiredCapability: "supportsMavlinkInspector", section: "Debug" },
  { id: "blackbox", label: "Blackbox", icon: <HardDrive size={14} />, requiredCapability: "supportsBlackbox", section: "Debug" },
  { id: "debug", label: "Debug", icon: <Bug size={14} />, requiredCapability: "supportsDebugValues", section: "Debug" },
  { id: "diagnostics", label: "Diagnostics", icon: <Stethoscope size={14} />, section: "Debug" },
  { id: "logs", label: "Log Analysis", icon: <BarChart3 size={14} />, section: "Debug" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DroneConfigureTabProps {
  droneId: string;
  droneName: string;
  isConnected: boolean;
}

export function DroneConfigureTab({ droneId, droneName, isConnected }: DroneConfigureTabProps) {
  const lastActivePanel = useSettingsStore((s) => s.lastActivePanel);
  const setLastActivePanelSetting = useSettingsStore((s) => s.setLastActivePanel);
  const [activePanel, setActivePanel] = useState(lastActivePanel || "outputs");
  const { supports, firmwareType } = useFirmwareCapabilities();

  // Persist active panel to settings store
  useEffect(() => {
    setLastActivePanelSetting(activePanel);
  }, [activePanel, setLastActivePanelSetting]);

  // Global FC keyboard shortcuts (Ctrl+S, Ctrl+Shift+S, Ctrl+R)
  const saveToRam = useFcPanelActionsStore((s) => s.saveToRam);
  const refresh = useFcPanelActionsStore((s) => s.refresh);
  useFcKeyboardShortcuts(saveToRam ?? undefined, refresh ?? undefined);

  // Reboot-required param tracking
  const rebootRequiredParams = useParamSafetyStore((s) => s.rebootRequiredParams);
  const rebootParamsList = useMemo(() => Array.from(rebootRequiredParams), [rebootRequiredParams]);

  // Filter nav items based on firmware capabilities
  const visibleItems = useMemo(
    () =>
      FC_NAV_ITEMS.filter(
        (item) => !item.requiredCapability || supports(item.requiredCapability),
      ),
    [supports],
  );

  // Group visible items by section
  const sections = useMemo(() => {
    const map = new Map<string, FcNavItem[]>();
    for (const item of visibleItems) {
      const s = item.section ?? "Other";
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(item);
    }
    return map;
  }, [visibleItems]);

  const firmwareLabel = firmwareType
    ? ({
        'ardupilot-copter': 'ArduCopter',
        'ardupilot-plane': 'ArduPlane',
        'ardupilot-rover': 'ArduRover',
        'ardupilot-sub': 'ArduSub',
        'px4': 'PX4',
        'betaflight': 'Betaflight',
        'inav': 'iNav',
        'unknown': 'Unknown',
      } as Record<string, string>)[firmwareType] ?? firmwareType
    : null;

  // Auto-select first visible panel if current becomes hidden
  useEffect(() => {
    if (!visibleItems.find((i) => i.id === activePanel) && visibleItems.length > 0) {
      setActivePanel(visibleItems[0].id);
    }
  }, [visibleItems, activePanel]);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Sidebar */}
      <nav className="w-[200px] border-r border-border-default bg-bg-secondary flex-shrink-0 overflow-y-auto">
        <div className="px-3 py-3 border-b border-border-default">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Flight Controller
          </h2>
          {firmwareLabel && (
            <span className="mt-1 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary">
              {firmwareLabel}
            </span>
          )}
          {firmwareType === 'px4' && (
            <span className="mt-1 block text-[10px] text-text-tertiary">
              Some panels (OSD, LED) are not available for PX4.
            </span>
          )}
          {firmwareType === 'betaflight' && (
            <span className="mt-1 block text-[10px] text-text-tertiary">
              Betaflight firmware. Some panels differ from ArduPilot.
            </span>
          )}
        </div>
        <div className="flex flex-col py-1">
          {[...sections.entries()].map(([section, items]) => (
            <div key={section}>
              <div className="px-3 pt-3 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {section}
                </span>
              </div>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => isConnected && setActivePanel(item.id)}
                  disabled={!isConnected}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer w-full",
                    !isConnected && "opacity-40 cursor-not-allowed",
                    isConnected && activePanel === item.id
                      ? "text-accent-primary bg-accent-primary/10 border-l-2 border-l-accent-primary"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-l-2 border-l-transparent",
                    !isConnected && "hover:bg-transparent hover:text-text-secondary"
                  )}
                >
                  {item.icon}
                  {(firmwareType && item.labelOverride?.[firmwareType]) ?? item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {!isConnected ? (
          <FcDisconnectedPlaceholder droneName={droneName} />
        ) : (
          <>
            <FlashCommitBanner />
            <RebootRequiredBanner rebootParams={rebootParamsList} />
            {activePanel === "outputs" && (
              firmwareType === 'px4' ? <ActuatorPanel /> :
              firmwareType === 'betaflight' ? <BfMotorsPanel /> :
              <OutputsPanel />
            )}
            {activePanel === "receiver" && <ReceiverPanel />}
            {activePanel === "modes" && <FlightModesPanel />}
            {activePanel === "aux-modes" && <AuxModesPanel />}
            {activePanel === "bf-motors" && <BfMotorsPanel />}
            {activePanel === "frame" && (firmwareType === 'px4' ? <AirframePanel /> : <FramePanel />)}
            {activePanel === "failsafe" && <FailsafePanel />}
            {activePanel === "geofence" && <GeofencePanel />}
            {activePanel === "health" && <PreArmPanel />}
            {activePanel === "sensors" && <SensorsPanel />}
            {activePanel === "power" && <PowerPanel />}
            {activePanel === "gps-config" && <GpsPanel />}
            {activePanel === "gimbal" && <GimbalPanel />}
            {activePanel === "camera" && <CameraPanel />}
            {activePanel === "pid" && <PidTuningPanel />}
            {activePanel === "rate-profiles" && <RateProfilePanel />}
            {activePanel === "adjustments" && <AdjustmentsPanel />}
            {activePanel === "sensor-graphs" && <SensorGraphPanel />}
            {activePanel === "osd" && <OsdEditorPanel />}
            {activePanel === "led" && <LedPanel />}
            {activePanel === "vtx" && <VtxPanel />}
            {activePanel === "ports" && <PortsPanel />}
            {activePanel === "radio" && <TelRadioPanel />}
            {activePanel === "bf-config" && <BetaflightConfigPanel />}
            {activePanel === "firmware" && <FirmwarePanel />}
            {activePanel === "cli" && (firmwareType === 'px4' ? <MavlinkShellPanel /> : <CliPanel />)}
            {activePanel === "mavlink" && <MavlinkInspectorPanel />}
            {activePanel === "blackbox" && <BlackboxPanel />}
            {activePanel === "debug" && <DebugPanel />}
            {activePanel === "diagnostics" && <DiagnosticsPanel />}
            {activePanel === "logs" && <LogAnalysisPanel />}
          </>
        )}
      </div>
    </div>
  );
}
