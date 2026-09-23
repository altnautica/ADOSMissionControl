/**
 * @module FcPanelRouter
 * @description Router that maps an activePanel id to the right FC panel
 * component. All ~60 panels are loaded with next/dynamic for code splitting.
 * Sub-component of DroneConfigureTab.
 * @license GPL-3.0-only
 */

"use client";

import dynamic from "next/dynamic";

const panelLoading = {
  loading: () => (
    <div className="flex items-center justify-center h-32">
      <span className="text-xs text-text-tertiary">Loading panel...</span>
    </div>
  ),
};

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
const OsdEditorPanel = dynamic(() => import("@/components/fc/osd/OsdEditorPanel").then(m => ({ default: m.OsdEditorPanel })), { ssr: false, ...panelLoading });
const BfOsdEditorPanel = dynamic(() => import("@/components/fc/betaflight/BfOsdEditorPanel").then(m => ({ default: m.BfOsdEditorPanel })), { ssr: false, ...panelLoading });
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
const AuxModesPanel = dynamic(() => import("@/components/fc/betaflight/AuxModesPanel").then(m => ({ default: m.AuxModesPanel })), { ssr: false, ...panelLoading });
const BetaflightConfigPanel = dynamic(() => import("@/components/fc/betaflight/BetaflightConfigPanel").then(m => ({ default: m.BetaflightConfigPanel })), { ssr: false, ...panelLoading });
const BfSettingsPanel = dynamic(() => import("@/components/fc/betaflight/BfSettingsPanel").then(m => ({ default: m.BfSettingsPanel })), { ssr: false, ...panelLoading });
const BfPortsPanel = dynamic(() => import("@/components/fc/betaflight/BfPortsPanel").then(m => ({ default: m.BfPortsPanel })), { ssr: false, ...panelLoading });
const BfLedStripPanel = dynamic(() => import("@/components/fc/betaflight/BfLedStripPanel").then(m => ({ default: m.BfLedStripPanel })), { ssr: false, ...panelLoading });
const BfReceiverPanel = dynamic(() => import("@/components/fc/betaflight/BfReceiverPanel").then(m => ({ default: m.BfReceiverPanel })), { ssr: false, ...panelLoading });
const BfMotorsPanel = dynamic(() => import("@/components/fc/motors/BfMotorsPanel").then(m => ({ default: m.BfMotorsPanel })), { ssr: false, ...panelLoading });
const VtxPanel = dynamic(() => import("@/components/fc/misc/VtxPanel").then(m => ({ default: m.VtxPanel })), { ssr: false, ...panelLoading });
const GpsPanel = dynamic(() => import("@/components/fc/sensors/GpsPanel").then(m => ({ default: m.GpsPanel })), { ssr: false, ...panelLoading });
const ArduPilotGpsPanel = dynamic(() => import("@/components/fc/sensors/ArduPilotGpsPanel").then(m => ({ default: m.ArduPilotGpsPanel })), { ssr: false, ...panelLoading });
const Ekf3Panel = dynamic(() => import("@/components/fc/ekf/Ekf3Panel").then(m => ({ default: m.Ekf3Panel })), { ssr: false, ...panelLoading });
const StreamRatesPanel = dynamic(() => import("@/components/fc/streams/StreamRatesPanel").then(m => ({ default: m.StreamRatesPanel })), { ssr: false, ...panelLoading });
const VtolPanel = dynamic(() => import("@/components/fc/vtol/VtolPanel").then(m => ({ default: m.VtolPanel })), { ssr: false, ...panelLoading });
const TecsPanel = dynamic(() => import("@/components/fc/tecs/TecsPanel").then(m => ({ default: m.TecsPanel })), { ssr: false, ...panelLoading });
const SubConfigPanel = dynamic(() => import("@/components/fc/sub/SubConfigPanel").then(m => ({ default: m.SubConfigPanel })), { ssr: false, ...panelLoading });
const Px4FlightBehaviorPanel = dynamic(() => import("@/components/fc/px4/Px4FlightBehaviorPanel").then(m => ({ default: m.Px4FlightBehaviorPanel })), { ssr: false, ...panelLoading });
const Px4FwTuningPanel = dynamic(() => import("@/components/fc/px4/Px4FwTuningPanel").then(m => ({ default: m.Px4FwTuningPanel })), { ssr: false, ...panelLoading });
const Px4AutotunePanel = dynamic(() => import("@/components/fc/px4/Px4AutotunePanel").then(m => ({ default: m.Px4AutotunePanel })), { ssr: false, ...panelLoading });
const Px4VtolPanel = dynamic(() => import("@/components/fc/px4/Px4VtolPanel").then(m => ({ default: m.Px4VtolPanel })), { ssr: false, ...panelLoading });
const Px4ControlAllocationPanel = dynamic(() => import("@/components/fc/px4/Px4ControlAllocationPanel").then(m => ({ default: m.Px4ControlAllocationPanel })), { ssr: false, ...panelLoading });
const Px4GpsPanel = dynamic(() => import("@/components/fc/px4/Px4GpsPanel").then(m => ({ default: m.Px4GpsPanel })), { ssr: false, ...panelLoading });
const Px4ThermalCalPanel = dynamic(() => import("@/components/fc/px4/Px4ThermalCalPanel").then(m => ({ default: m.Px4ThermalCalPanel })), { ssr: false, ...panelLoading });
const ArduPilotNonGpsPanel = dynamic(() => import("@/components/fc/sensors/ArduPilotNonGpsPanel").then(m => ({ default: m.ArduPilotNonGpsPanel })), { ssr: false, ...panelLoading });
const ArduPilotHeliPanel = dynamic(() => import("@/components/fc/frame/ArduPilotHeliPanel").then(m => ({ default: m.ArduPilotHeliPanel })), { ssr: false, ...panelLoading });
const BlackboxPanel = dynamic(() => import("@/components/fc/comms/BlackboxPanel").then(m => ({ default: m.BlackboxPanel })), { ssr: false, ...panelLoading });
const RateProfilePanel = dynamic(() => import("@/components/fc/betaflight/RateProfilePanel").then(m => ({ default: m.RateProfilePanel })), { ssr: false, ...panelLoading });
const AdjustmentsPanel = dynamic(() => import("@/components/fc/betaflight/AdjustmentsPanel").then(m => ({ default: m.AdjustmentsPanel })), { ssr: false, ...panelLoading });
const CanConfigPage = dynamic(() => import("@/components/config/can/CanConfigPage").then(m => ({ default: m.CanConfigPage })), { ssr: false, ...panelLoading });
const SigningPanel = dynamic(() => import("@/components/fc/security/SigningPanel").then(m => ({ default: m.SigningPanel })), { ssr: false, ...panelLoading });
const SafehomePanel = dynamic(() => import("@/components/fc/inav/SafehomePanel").then(m => ({ default: m.SafehomePanel })), { ssr: false, ...panelLoading });
const GeozonePanel = dynamic(() => import("@/components/fc/inav/GeozonePanel").then(m => ({ default: m.GeozonePanel })), { ssr: false, ...panelLoading });
const NavConfigPanel = dynamic(() => import("@/components/fc/inav/NavConfigPanel").then(m => ({ default: m.NavConfigPanel })), { ssr: false, ...panelLoading });
const INavFailsafePanel = dynamic(() => import("@/components/fc/inav/INavFailsafePanel").then(m => ({ default: m.INavFailsafePanel })), { ssr: false, ...panelLoading });
const BatteryProfilePanel = dynamic(() => import("@/components/fc/inav/BatteryProfilePanel").then(m => ({ default: m.BatteryProfilePanel })), { ssr: false, ...panelLoading });
const ControlProfilePanel = dynamic(() => import("@/components/fc/inav/ControlProfilePanel").then(m => ({ default: m.ControlProfilePanel })), { ssr: false, ...panelLoading });
const MixerProfilePanel = dynamic(() => import("@/components/fc/inav/MixerProfilePanel").then(m => ({ default: m.MixerProfilePanel })), { ssr: false, ...panelLoading });
const OutputMappingPanel = dynamic(() => import("@/components/fc/inav/OutputMappingPanel").then(m => ({ default: m.OutputMappingPanel })), { ssr: false, ...panelLoading });
const ServosPanel = dynamic(() => import("@/components/fc/inav/ServosPanel").then(m => ({ default: m.ServosPanel })), { ssr: false, ...panelLoading });
const TempSensorsPanel = dynamic(() => import("@/components/fc/inav/TempSensorsPanel").then(m => ({ default: m.TempSensorsPanel })), { ssr: false, ...panelLoading });
const McBrakingPanel = dynamic(() => import("@/components/fc/inav/McBrakingPanel").then(m => ({ default: m.McBrakingPanel })), { ssr: false, ...panelLoading });
const RateDynamicsPanel = dynamic(() => import("@/components/fc/inav/RateDynamicsPanel").then(m => ({ default: m.RateDynamicsPanel })), { ssr: false, ...panelLoading });
const INavMissionPanel = dynamic(() => import("@/components/fc/inav/INavMissionPanel").then(m => ({ default: m.INavMissionPanel })), { ssr: false, ...panelLoading });
const EzTunePanel = dynamic(() => import("@/components/fc/inav/EzTunePanel").then(m => ({ default: m.EzTunePanel })), { ssr: false, ...panelLoading });
const FwApproachPanel = dynamic(() => import("@/components/fc/inav/FwApproachPanel").then(m => ({ default: m.FwApproachPanel })), { ssr: false, ...panelLoading });
const INavOsdPanel = dynamic(() => import("@/components/fc/inav/INavOsdPanel").then(m => ({ default: m.INavOsdPanel })), { ssr: false, ...panelLoading });
const CustomOsdElementsPanel = dynamic(() => import("@/components/fc/inav/CustomOsdElementsPanel").then(m => ({ default: m.CustomOsdElementsPanel })), { ssr: false, ...panelLoading });
const DisplayPortOsdPanel = dynamic(() => import("@/components/fc/osd/DisplayPortOsdPanel").then(m => ({ default: m.DisplayPortOsdPanel })), { ssr: false, ...panelLoading });
const LogicConditionsPanel = dynamic(() => import("@/components/fc/inav/programming/LogicConditionsPanel").then(m => ({ default: m.LogicConditionsPanel })), { ssr: false, ...panelLoading });
const GlobalVariablesPanel = dynamic(() => import("@/components/fc/inav/programming/GlobalVariablesPanel").then(m => ({ default: m.GlobalVariablesPanel })), { ssr: false, ...panelLoading });
const ProgrammingPidPanel = dynamic(() => import("@/components/fc/inav/programming/ProgrammingPidPanel").then(m => ({ default: m.ProgrammingPidPanel })), { ssr: false, ...panelLoading });
const LcProgrammingPanel = dynamic(() => import("@/components/fc/inav/programming/LcProgrammingPanel").then(m => ({ default: m.LcProgrammingPanel })), { ssr: false, ...panelLoading });
const NavPidPanel = dynamic(() => import("@/components/fc/inav/NavPidPanel").then(m => ({ default: m.NavPidPanel })), { ssr: false, ...panelLoading });
const CalibrationPanel = dynamic(() => import("@/components/fc/calibration/CalibrationPanel").then(m => ({ default: m.CalibrationPanel })), { ssr: false, ...panelLoading });
const AirspeedPanel = dynamic(() => import("@/components/fc/airspeed/AirspeedPanel").then(m => ({ default: m.AirspeedPanel })), { ssr: false, ...panelLoading });
const HarmonicNotchPanel = dynamic(() => import("@/components/fc/notch/HarmonicNotchPanel").then(m => ({ default: m.HarmonicNotchPanel })), { ssr: false, ...panelLoading });
const SailboatPanel = dynamic(() => import("@/components/fc/sailboat/SailboatPanel").then(m => ({ default: m.SailboatPanel })), { ssr: false, ...panelLoading });
const PayloadPanel = dynamic(() => import("@/components/fc/payload/PayloadPanel").then(m => ({ default: m.PayloadPanel })), { ssr: false, ...panelLoading });
const AdsbPanel = dynamic(() => import("@/components/fc/adsb/AdsbPanel").then(m => ({ default: m.AdsbPanel })), { ssr: false, ...panelLoading });
const DroneScriptsTab = dynamic(() => import("@/components/dashboard/drone-scripts/DroneScriptsTab").then(m => ({ default: m.DroneScriptsTab })), { ssr: false, ...panelLoading });

interface FcPanelRouterProps {
  activePanel: string;
  firmwareType: string | null;
}

export function FcPanelRouter({ activePanel, firmwareType }: FcPanelRouterProps) {
  if (activePanel === "calibrate") return <CalibrationPanel />;
  if (activePanel === "outputs") {
    if (firmwareType === "px4") return <ActuatorPanel />;
    if (firmwareType === "betaflight") return <BfMotorsPanel />;
    return <OutputsPanel />;
  }
  if (activePanel === "frame") {
    return firmwareType === "px4" ? <AirframePanel /> : <FramePanel />;
  }
  if (activePanel === "cli") {
    return firmwareType === "px4" ? <MavlinkShellPanel /> : <CliPanel />;
  }
  if (activePanel === "gps-config") {
    // ArduPilot exposes the AP_GPS driver surface (types, blending, GNSS mask,
    // yaw); PX4 exposes the GPS driver params (protocol, GNSS bitmask, u-blox
    // setup); Betaflight uses the MSP GPS + GPS-Rescue panel (not offered on iNav).
    if (firmwareType?.startsWith("ardupilot")) return <ArduPilotGpsPanel />;
    if (firmwareType === "px4") return <Px4GpsPanel />;
    return <GpsPanel />;
  }
  if (activePanel === "ports") {
    // Betaflight uses a binary function-mask serial config; ArduPilot/iNav use
    // the SERIALn_* parameter panel.
    return firmwareType === "betaflight" ? <BfPortsPanel /> : <PortsPanel />;
  }
  if (activePanel === "osd") {
    // Betaflight drives the OSD over MSP (grid + character font); ArduPilot uses
    // the OSDn_<ITEM>_EN/_X/_Y parameter editor.
    return firmwareType === "betaflight" ? <BfOsdEditorPanel /> : <OsdEditorPanel />;
  }
  if (activePanel === "led") {
    // Betaflight edits a per-LED packed strip config over MSP; ArduPilot uses
    // the NTF_LED_* notification-LED panel.
    return firmwareType === "betaflight" ? <BfLedStripPanel /> : <LedPanel />;
  }
  if (activePanel === "receiver") {
    // Betaflight drives receiver config over MSP; ArduPilot/iNav use the
    // RC*/RCMAP parameter panel.
    return firmwareType === "betaflight" ? <BfReceiverPanel /> : <ReceiverPanel />;
  }

  switch (activePanel) {
    case "modes": return <FlightModesPanel />;
    case "aux-modes": return <AuxModesPanel />;
    case "bf-motors": return <BfMotorsPanel />;
    case "failsafe": return <FailsafePanel />;
    case "geofence": return <GeofencePanel />;
    case "safehome": return <SafehomePanel />;
    case "geozone": return <GeozonePanel />;
    case "inav-nav-config": return <NavConfigPanel />;
    case "inav-mission": return <INavMissionPanel />;
    case "inav-mixer-profile": return <MixerProfilePanel />;
    case "inav-output-mapping": return <OutputMappingPanel />;
    case "inav-servos": return <ServosPanel />;
    case "inav-failsafe": return <INavFailsafePanel />;
    case "inav-battery-profile": return <BatteryProfilePanel />;
    case "inav-temp-sensors": return <TempSensorsPanel />;
    case "inav-control-profile": return <ControlProfilePanel />;
    case "inav-mc-braking": return <McBrakingPanel />;
    case "inav-rate-dynamics": return <RateDynamicsPanel />;
    case "inav-ez-tune": return <EzTunePanel />;
    case "inav-fw-approach": return <FwApproachPanel />;
    case "inav-osd": return <INavOsdPanel />;
    case "inav-custom-osd": return <CustomOsdElementsPanel />;
    case "displayport-osd": return <DisplayPortOsdPanel />;
    case "inav-logic-conditions": return <LogicConditionsPanel />;
    case "inav-global-variables": return <GlobalVariablesPanel />;
    case "inav-programming-pid": return <ProgrammingPidPanel />;
    case "inav-js-programming": return <LcProgrammingPanel />;
    case "inav-nav-pid": return <NavPidPanel />;
    case "scripts": return <DroneScriptsTab />;
    case "health": return <PreArmPanel />;
    case "sensors": return <SensorsPanel />;
    case "power": return <PowerPanel />;
    case "gimbal": return <GimbalPanel />;
    case "camera": return <CameraPanel />;
    case "airspeed": return <AirspeedPanel />;
    case "notch": return <HarmonicNotchPanel />;
    case "sailboat": return <SailboatPanel />;
    case "payload": return <PayloadPanel />;
    case "adsb": return <AdsbPanel />;
    case "ekf3": return <Ekf3Panel />;
    case "stream-rates": return <StreamRatesPanel />;
    case "vtol": return <VtolPanel />;
    case "tecs": return <TecsPanel />;
    case "sub-config": return <SubConfigPanel />;
    case "px4-flight-behavior": return <Px4FlightBehaviorPanel />;
    case "px4-fw-tuning": return <Px4FwTuningPanel />;
    case "px4-autotune": return <Px4AutotunePanel />;
    case "px4-vtol": return <Px4VtolPanel />;
    case "px4-control-allocation": return <Px4ControlAllocationPanel />;
    case "px4-thermal": return <Px4ThermalCalPanel />;
    case "ap-nongps": return <ArduPilotNonGpsPanel />;
    case "ap-heli": return <ArduPilotHeliPanel />;
    case "pid": return <PidTuningPanel />;
    case "rate-profiles": return <RateProfilePanel />;
    case "adjustments": return <AdjustmentsPanel />;
    case "sensor-graphs": return <SensorGraphPanel />;
    case "vtx": return <VtxPanel />;
    case "radio": return <TelRadioPanel />;
    case "bf-config": return <BetaflightConfigPanel />;
    case "bf-settings": return <BfSettingsPanel />;
    case "firmware": return <FirmwarePanel />;
    case "signing": return <SigningPanel />;
    case "mavlink": return <MavlinkInspectorPanel />;
    case "blackbox": return <BlackboxPanel />;
    case "debug": return <DebugPanel />;
    case "diagnostics": return <DiagnosticsPanel />;
    case "logs": return <LogAnalysisPanel />;
    case "can": return <CanConfigPage />;
    default: return null;
  }
}
