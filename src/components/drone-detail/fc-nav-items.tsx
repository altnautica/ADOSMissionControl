/**
 * @module fc-nav-items
 * @description Navigation item registry for the drone configure tab.
 * Lists every available FC sub-panel with its capability gate, section,
 * and per-firmware label overrides. Sub-component of DroneConfigureTab.
 * @license GPL-3.0-only
 */

"use client";

import type { ReactNode } from "react";
import type { ProtocolCapabilities, VehicleClass, FirmwareType } from "@/lib/protocol/types";
import {
  Cpu,
  Radio,
  SlidersHorizontal,
  ShieldAlert,
  Battery,
  Terminal,
  Braces,
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
  Network,
  Home,
  Compass,
  Plane,
  Wind,
  Waves,
  Wand2,
  ArrowLeftRight,
  Thermometer,
  Navigation,
  Fan,
  Sailboat,
  Grab,
  Radar,
  ScrollText,
} from "lucide-react";

export interface FcNavItem {
  id: string;
  /** Key under the `fcNav` locale namespace. */
  labelKey: string;
  icon: ReactNode;
  requiredCapability?: keyof ProtocolCapabilities;
  /** Restrict the item to specific vehicle classes. Firmware capabilities are
   *  shared across a firmware's vehicles (e.g. all ArduPilot vehicles share one
   *  capability set), so vehicle-specific panels (QuadPlane `Q_*`, sub depth)
   *  gate on the detected vehicle class instead. Omit to show for any vehicle. */
  vehicleClasses?: VehicleClass[];
  /** Restrict to a specific raw MAV_TYPE. Used where the vehicle class is not
   *  discriminating enough — e.g. a traditional helicopter reports MAV_TYPE
   *  HELICOPTER (4) but shares the "copter" class with multirotors. Omit to
   *  show for any type. */
  requiredVehicleType?: number;
  /** Hide the item on specific firmwares. A capability can be shared across
   *  firmwares (e.g. iNav, Betaflight, and ArduPilot all support failsafe), so a
   *  generic MAVLink panel gated only on that capability leaks onto MSP firmwares
   *  that either configure it over MSP or have their own dedicated surface. This
   *  is the firmware-scope escape hatch the capability gate can't express. */
  excludeFirmware?: FirmwareType[];
  /** The panel writes the COMPANION AGENT's configuration, not the flight
   *  controller's. It therefore stays selectable while the FC link is down —
   *  it is how the operator fixes a down link — and needs a reachable agent
   *  rather than a connected FC. */
  agentSide?: boolean;
  section?: string;
  /** Per-firmware `fcNav` label key, replacing `labelKey` on that firmware. */
  labelOverride?: Partial<Record<FirmwareType, string>>;
}

export const FC_NAV_ITEMS: FcNavItem[] = [
  // Flight
  { id: "outputs", labelKey: "outputs", icon: <Cpu size={14} />, section: "Flight", labelOverride: { px4: "actuators" } },
  { id: "receiver", labelKey: "receiver", icon: <Radio size={14} />, requiredCapability: "supportsReceiver", section: "Flight" },
  { id: "modes", labelKey: "flightModes", icon: <SlidersHorizontal size={14} />, requiredCapability: "supportsFlightModes", section: "Flight" },
  { id: "aux-modes", labelKey: "auxModes", icon: <ToggleLeft size={14} />, requiredCapability: "supportsAuxModes", section: "Flight" },
  { id: "bf-motors", labelKey: "motorsEsc", icon: <Cpu size={14} />, requiredCapability: "supportsMspMotors", section: "Flight" },
  { id: "frame", labelKey: "frameSetup", icon: <Box size={14} />, section: "Flight", labelOverride: { px4: "airframe" } },
  { id: "ap-heli", labelKey: "apHeli", icon: <Fan size={14} />, requiredCapability: "supportsEkfConfig", requiredVehicleType: 4, section: "Flight" },
  { id: "vtol", labelKey: "vtol", icon: <Plane size={14} />, requiredCapability: "supportsVtolConfig", vehicleClasses: ["plane", "vtol"], section: "Flight" },
  { id: "sub-config", labelKey: "subConfig", icon: <Waves size={14} />, requiredCapability: "supportsSubConfig", vehicleClasses: ["sub"], section: "Flight" },
  // Safety
  { id: "failsafe", labelKey: "failsafe", icon: <ShieldAlert size={14} />, requiredCapability: "supportsFailsafe", excludeFirmware: ["betaflight", "inav"], section: "Safety" },
  { id: "geofence", labelKey: "geofence", icon: <Shield size={14} />, requiredCapability: "supportsGeoFence", excludeFirmware: ["inav"], section: "Safety" },
  { id: "safehome", labelKey: "safehome", icon: <Home size={14} />, requiredCapability: "supportsSafehome", section: "Safety" },
  { id: "geozone", labelKey: "geozone", icon: <MapPin size={14} />, requiredCapability: "supportsGeozone", section: "Safety" },
  { id: "health", labelKey: "healthCheck", icon: <HeartPulse size={14} />, section: "Safety" },
  // Sensors
  { id: "calibrate", labelKey: "calibrate", icon: <Move3d size={14} />, section: "Sensors" },
  { id: "sensors", labelKey: "sensors", icon: <Gauge size={14} />, section: "Sensors" },
  { id: "px4-thermal", labelKey: "px4Thermal", icon: <Thermometer size={14} />, requiredCapability: "supportsPx4Tuning", section: "Sensors" },
  // iNav has neither the ArduPilot BATT_* params nor Betaflight's GPS Rescue
  // (MSP_GPS_RESCUE); its battery lives under "Battery Profiles".
  { id: "power", labelKey: "power", icon: <Battery size={14} />, requiredCapability: "supportsPowerConfig", excludeFirmware: ["inav"], section: "Sensors" },
  { id: "gps-config", labelKey: "gpsConfig", icon: <MapPin size={14} />, requiredCapability: "supportsGpsConfig", excludeFirmware: ["inav"], section: "Sensors" },
  { id: "ekf3", labelKey: "ekf3", icon: <Compass size={14} />, requiredCapability: "supportsEkfConfig", section: "Sensors" },
  { id: "ap-nongps", labelKey: "apNongps", icon: <Navigation size={14} />, requiredCapability: "supportsEkfConfig", section: "Sensors" },
  { id: "gimbal", labelKey: "gimbal", icon: <Move3d size={14} />, requiredCapability: "supportsGimbal", section: "Sensors" },
  { id: "camera", labelKey: "camera", icon: <Camera size={14} />, requiredCapability: "supportsCamera", section: "Sensors" },
  { id: "airspeed", labelKey: "airspeed", icon: <Wind size={14} />, requiredCapability: "supportsEkfConfig", vehicleClasses: ["plane", "vtol"], section: "Sensors" },
  { id: "payload", labelKey: "payload", icon: <Grab size={14} />, requiredCapability: "supportsEkfConfig", section: "Sensors" },
  { id: "notch", labelKey: "notch", icon: <Activity size={14} />, requiredCapability: "supportsEkfConfig", section: "Tuning" },
  { id: "adsb", labelKey: "adsb", icon: <Radar size={14} />, requiredCapability: "supportsEkfConfig", vehicleClasses: ["copter", "plane", "vtol"], section: "Safety" },
  { id: "sailboat", labelKey: "sailboat", icon: <Sailboat size={14} />, requiredCapability: "supportsEkfConfig", vehicleClasses: ["rover"], section: "Flight" },
  // Tuning
  { id: "pid", labelKey: "pidTuning", icon: <Activity size={14} />, requiredCapability: "supportsPidTuning", excludeFirmware: ["betaflight", "inav"], section: "Tuning" },
  { id: "tecs", labelKey: "tecs", icon: <Wind size={14} />, requiredCapability: "supportsTecsConfig", vehicleClasses: ["plane", "vtol"], section: "Tuning" },
  { id: "px4-flight-behavior", labelKey: "px4FlightBehavior", icon: <Gauge size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["copter", "vtol"], section: "Tuning" },
  { id: "px4-fw-tuning", labelKey: "px4FwTuning", icon: <Plane size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["plane", "vtol"], section: "Tuning" },
  { id: "px4-autotune", labelKey: "px4Autotune", icon: <Wand2 size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["copter", "plane", "vtol"], section: "Tuning" },
  { id: "px4-vtol", labelKey: "px4Vtol", icon: <ArrowLeftRight size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["vtol"], section: "Flight" },
  { id: "px4-control-allocation", labelKey: "px4ControlAllocation", icon: <Sliders size={14} />, requiredCapability: "supportsPx4Tuning", section: "Tuning" },
  { id: "rate-profiles", labelKey: "rateProfiles", icon: <Activity size={14} />, requiredCapability: "supportsRateProfiles", section: "Tuning" },
  { id: "adjustments", labelKey: "adjustments", icon: <Sliders size={14} />, requiredCapability: "supportsAdjustments", section: "Tuning" },
  { id: "sensor-graphs", labelKey: "sensorGraphs", icon: <BarChart3 size={14} />, section: "Tuning" },
  // Display
  { id: "osd", labelKey: "osdEditor", icon: <Layers size={14} />, requiredCapability: "supportsOsd", excludeFirmware: ["inav"], section: "Display" },
  { id: "led", labelKey: "ledStrip", icon: <Lightbulb size={14} />, requiredCapability: "supportsLed", excludeFirmware: ["inav"], section: "Display" },
  { id: "vtx", labelKey: "vtx", icon: <Radio size={14} />, requiredCapability: "supportsVtx", section: "Display" },
  // System
  // The agent-side MAVLink source (auto / serial / udp / tcp + port + baud).
  // This is the control that fixes "the companion can't find my flight
  // controller", so it lives on the same tab as the placeholder that reports
  // the problem, and it is reachable while the FC link is down.
  { id: "fc-source", labelKey: "fcSource", icon: <Cable size={14} />, agentSide: true, section: "System" },
  { id: "ports", labelKey: "ports", icon: <Cable size={14} />, requiredCapability: "supportsPorts", section: "System" },
  { id: "stream-rates", labelKey: "streamRates", icon: <Gauge size={14} />, requiredCapability: "supportsStreamRates", section: "System" },
  { id: "radio", labelKey: "radioConfig", icon: <Wifi size={14} />, excludeFirmware: ["betaflight", "inav"], section: "System" },
  { id: "bf-config", labelKey: "configuration", icon: <Settings size={14} />, requiredCapability: "supportsBetaflightConfig", section: "System" },
  { id: "bf-settings", labelKey: "bfSettings", icon: <Sliders size={14} />, requiredCapability: "supportsCliSettings", section: "System" },
  { id: "signing", labelKey: "signing", icon: <Shield size={14} />, requiredCapability: "supportsMavlinkSigning", section: "Security" },
  { id: "firmware", labelKey: "firmwarePanel", icon: <Zap size={14} />, requiredCapability: "supportsFirmwareFlash", section: "System" },
  { id: "cli", labelKey: "cli", icon: <Terminal size={14} />, requiredCapability: "supportsCliShell", section: "System", labelOverride: { px4: "shell" } },
  // Debug
  { id: "mavlink", labelKey: "mavlinkInspector", icon: <Monitor size={14} />, requiredCapability: "supportsMavlinkInspector", section: "Debug" },
  { id: "blackbox", labelKey: "blackbox", icon: <HardDrive size={14} />, requiredCapability: "supportsBlackbox", section: "Debug" },
  { id: "debug", labelKey: "debugPanel", icon: <Bug size={14} />, requiredCapability: "supportsDebugValues", section: "Debug" },
  { id: "diagnostics", labelKey: "diagnostics", icon: <Stethoscope size={14} />, section: "Debug" },
  { id: "logs", labelKey: "logAnalysis", icon: <BarChart3 size={14} />, section: "Debug" },
  { id: "can", labelKey: "can", icon: <Network size={14} />, requiredCapability: "supportsCanFrame", section: "Debug" },
  // Programming — ArduPilot onboard Lua scripting (APM/scripts/ over MAVLink
  // FTP). ArduPilot-only; Betaflight/iNav have no Lua VM and PX4's scripting is
  // separate. Excluded by firmware (not a capability) so it stays forward-
  // compatible if another firmware gains scripting.
  { id: "scripts", labelKey: "scripts", icon: <ScrollText size={14} />, excludeFirmware: ["px4", "betaflight", "inav"], section: "Programming" },
  // iNav-specific
  { id: "inav-nav-config", labelKey: "inavNavConfig", icon: <MapPin size={14} />, requiredCapability: "supportsSettings", section: "Flight" },
  { id: "inav-mission", labelKey: "inavMission", icon: <MapPin size={14} />, requiredCapability: "supportsMultiMission", section: "Flight" },
  { id: "inav-mixer-profile", labelKey: "inavMixerProfile", icon: <Cpu size={14} />, requiredCapability: "supportsMixerProfile", section: "Flight" },
  { id: "inav-output-mapping", labelKey: "inavOutputMapping", icon: <Cpu size={14} />, requiredCapability: "supportsOutputMappingExt", section: "Flight" },
  { id: "inav-servos", labelKey: "inavServos", icon: <Sliders size={14} />, requiredCapability: "supportsServoMixer", section: "Flight" },
  { id: "inav-failsafe", labelKey: "inavFailsafe", icon: <ShieldAlert size={14} />, requiredCapability: "supportsSettings", section: "Safety" },
  { id: "inav-battery-profile", labelKey: "inavBatteryProfile", icon: <Battery size={14} />, requiredCapability: "supportsBatteryProfile", section: "Sensors" },
  { id: "inav-temp-sensors", labelKey: "inavTempSensors", icon: <Gauge size={14} />, requiredCapability: "supportsTempSensors", section: "Sensors" },
  { id: "inav-control-profile", labelKey: "inavControlProfile", icon: <Activity size={14} />, requiredCapability: "supportsSettings", section: "Tuning" },
  { id: "inav-mc-braking", labelKey: "inavMcBraking", icon: <Activity size={14} />, requiredCapability: "supportsMcBraking", section: "Tuning" },
  { id: "inav-rate-dynamics", labelKey: "inavRateDynamics", icon: <Activity size={14} />, requiredCapability: "supportsRateDynamics", section: "Tuning" },
  { id: "inav-ez-tune", labelKey: "inavEzTune", icon: <Sliders size={14} />, requiredCapability: "supportsEzTune", section: "Tuning" },
  { id: "inav-fw-approach", labelKey: "inavFwApproach", icon: <MapPin size={14} />, requiredCapability: "supportsFwApproach", section: "Flight" },
  { id: "inav-osd", labelKey: "inavOsd", icon: <Layers size={14} />, requiredCapability: "supportsCustomOsd", section: "Display" },
  { id: "inav-custom-osd", labelKey: "inavCustomOsd", icon: <Monitor size={14} />, requiredCapability: "supportsCustomOsd", section: "Display" },
  { id: "displayport-osd", labelKey: "displayportOsd", icon: <Monitor size={14} />, requiredCapability: "supportsDisplayPort", section: "Display" },
  { id: "inav-logic-conditions", labelKey: "inavLogicConditions", icon: <Zap size={14} />, requiredCapability: "supportsLogicConditions", section: "Programming" },
  { id: "inav-global-variables", labelKey: "inavGlobalVariables", icon: <Activity size={14} />, requiredCapability: "supportsGlobalVariables", section: "Programming" },
  { id: "inav-programming-pid", labelKey: "inavProgrammingPid", icon: <Sliders size={14} />, requiredCapability: "supportsProgrammingPid", section: "Programming" },
  { id: "inav-js-programming", labelKey: "inavJsProgramming", icon: <Braces size={14} />, requiredCapability: "supportsLogicConditions", section: "Programming" },
  { id: "inav-nav-pid", labelKey: "inavNavPid", icon: <Activity size={14} />, requiredCapability: "supportsSettings", section: "Tuning" },
];
