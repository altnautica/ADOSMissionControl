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
  label: string;
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
  labelOverride?: Partial<Record<string, string>>;
}

export const FC_NAV_ITEMS: FcNavItem[] = [
  // Flight
  { id: "outputs", label: "Outputs", icon: <Cpu size={14} />, section: "Flight", labelOverride: { px4: "Actuators" } },
  { id: "receiver", label: "Receiver", icon: <Radio size={14} />, requiredCapability: "supportsReceiver", section: "Flight" },
  { id: "modes", label: "Flight Modes", icon: <SlidersHorizontal size={14} />, requiredCapability: "supportsFlightModes", section: "Flight" },
  { id: "aux-modes", label: "Aux Modes", icon: <ToggleLeft size={14} />, requiredCapability: "supportsAuxModes", section: "Flight" },
  { id: "bf-motors", label: "Motors & ESC", icon: <Cpu size={14} />, requiredCapability: "supportsMspMotors", section: "Flight" },
  { id: "frame", label: "Frame", icon: <Box size={14} />, section: "Flight", labelOverride: { px4: "Airframe" } },
  { id: "ap-heli", label: "Helicopter", icon: <Fan size={14} />, requiredCapability: "supportsEkfConfig", requiredVehicleType: 4, section: "Flight" },
  { id: "vtol", label: "VTOL", icon: <Plane size={14} />, requiredCapability: "supportsVtolConfig", vehicleClasses: ["plane", "vtol"], section: "Flight" },
  { id: "sub-config", label: "Sub Config", icon: <Waves size={14} />, requiredCapability: "supportsSubConfig", vehicleClasses: ["sub"], section: "Flight" },
  // Safety
  { id: "failsafe", label: "Failsafe", icon: <ShieldAlert size={14} />, requiredCapability: "supportsFailsafe", excludeFirmware: ["betaflight", "inav"], section: "Safety" },
  { id: "geofence", label: "Geofence", icon: <Shield size={14} />, requiredCapability: "supportsGeoFence", excludeFirmware: ["inav"], section: "Safety" },
  { id: "safehome", label: "Safehome", icon: <Home size={14} />, requiredCapability: "supportsSafehome", section: "Safety" },
  { id: "geozone", label: "Geozones", icon: <MapPin size={14} />, requiredCapability: "supportsGeozone", section: "Safety" },
  { id: "health", label: "Health Check", icon: <HeartPulse size={14} />, section: "Safety" },
  // Sensors
  { id: "calibrate", label: "Calibration", icon: <Move3d size={14} />, section: "Sensors" },
  { id: "sensors", label: "Sensors", icon: <Gauge size={14} />, section: "Sensors" },
  { id: "px4-thermal", label: "Thermal Cal", icon: <Thermometer size={14} />, requiredCapability: "supportsPx4Tuning", section: "Sensors" },
  // iNav has neither the ArduPilot BATT_* params nor Betaflight's GPS Rescue
  // (MSP_GPS_RESCUE); its battery lives under "Battery Profiles".
  { id: "power", label: "Power", icon: <Battery size={14} />, requiredCapability: "supportsPowerConfig", excludeFirmware: ["inav"], section: "Sensors" },
  { id: "gps-config", label: "GPS", icon: <MapPin size={14} />, requiredCapability: "supportsGpsConfig", excludeFirmware: ["inav"], section: "Sensors" },
  { id: "ekf3", label: "EKF3", icon: <Compass size={14} />, requiredCapability: "supportsEkfConfig", section: "Sensors" },
  { id: "ap-nongps", label: "Non-GPS Nav", icon: <Navigation size={14} />, requiredCapability: "supportsEkfConfig", section: "Sensors" },
  { id: "gimbal", label: "Gimbal", icon: <Move3d size={14} />, requiredCapability: "supportsGimbal", section: "Sensors" },
  { id: "camera", label: "Camera", icon: <Camera size={14} />, requiredCapability: "supportsCamera", section: "Sensors" },
  { id: "airspeed", label: "Airspeed", icon: <Wind size={14} />, requiredCapability: "supportsEkfConfig", vehicleClasses: ["plane", "vtol"], section: "Sensors" },
  { id: "payload", label: "Gripper / Payload", icon: <Grab size={14} />, requiredCapability: "supportsEkfConfig", section: "Sensors" },
  { id: "notch", label: "Harmonic Notch", icon: <Activity size={14} />, requiredCapability: "supportsEkfConfig", section: "Tuning" },
  { id: "adsb", label: "ADS-B & Avoidance", icon: <Radar size={14} />, requiredCapability: "supportsEkfConfig", vehicleClasses: ["copter", "plane", "vtol"], section: "Safety" },
  { id: "sailboat", label: "Sailboat", icon: <Sailboat size={14} />, requiredCapability: "supportsEkfConfig", vehicleClasses: ["rover"], section: "Flight" },
  // Tuning
  { id: "pid", label: "PID Tuning", icon: <Activity size={14} />, requiredCapability: "supportsPidTuning", excludeFirmware: ["betaflight", "inav"], section: "Tuning" },
  { id: "tecs", label: "TECS / L1", icon: <Wind size={14} />, requiredCapability: "supportsTecsConfig", vehicleClasses: ["plane", "vtol"], section: "Tuning" },
  { id: "px4-flight-behavior", label: "Flight Behavior", icon: <Gauge size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["copter", "vtol"], section: "Tuning" },
  { id: "px4-fw-tuning", label: "Fixed-Wing Tuning", icon: <Plane size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["plane", "vtol"], section: "Tuning" },
  { id: "px4-autotune", label: "Autotune", icon: <Wand2 size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["copter", "plane", "vtol"], section: "Tuning" },
  { id: "px4-vtol", label: "VTOL Transition", icon: <ArrowLeftRight size={14} />, requiredCapability: "supportsPx4Tuning", vehicleClasses: ["vtol"], section: "Flight" },
  { id: "px4-control-allocation", label: "Control Allocation", icon: <Sliders size={14} />, requiredCapability: "supportsPx4Tuning", section: "Tuning" },
  { id: "rate-profiles", label: "Rate Profiles", icon: <Activity size={14} />, requiredCapability: "supportsRateProfiles", section: "Tuning" },
  { id: "adjustments", label: "Adjustments", icon: <Sliders size={14} />, requiredCapability: "supportsAdjustments", section: "Tuning" },
  { id: "sensor-graphs", label: "Sensor Graphs", icon: <BarChart3 size={14} />, section: "Tuning" },
  // Display
  { id: "osd", label: "OSD Editor", icon: <Layers size={14} />, requiredCapability: "supportsOsd", excludeFirmware: ["inav"], section: "Display" },
  { id: "led", label: "LED Strip", icon: <Lightbulb size={14} />, requiredCapability: "supportsLed", excludeFirmware: ["inav"], section: "Display" },
  { id: "vtx", label: "VTX", icon: <Radio size={14} />, requiredCapability: "supportsVtx", section: "Display" },
  // System
  // The agent-side MAVLink source (auto / serial / udp / tcp + port + baud).
  // This is the control that fixes "the companion can't find my flight
  // controller", so it lives on the same tab as the placeholder that reports
  // the problem, and it is reachable while the FC link is down.
  { id: "fc-source", label: "FC Source", icon: <Cable size={14} />, agentSide: true, section: "System" },
  { id: "ports", label: "Ports", icon: <Cable size={14} />, requiredCapability: "supportsPorts", section: "System" },
  { id: "stream-rates", label: "Stream Rates", icon: <Gauge size={14} />, requiredCapability: "supportsStreamRates", section: "System" },
  { id: "radio", label: "Radio Config", icon: <Wifi size={14} />, excludeFirmware: ["betaflight", "inav"], section: "System" },
  { id: "bf-config", label: "Configuration", icon: <Settings size={14} />, requiredCapability: "supportsBetaflightConfig", section: "System" },
  { id: "bf-settings", label: "All Settings", icon: <Sliders size={14} />, requiredCapability: "supportsCliSettings", section: "System" },
  { id: "signing", label: "MAVLink Signing", icon: <Shield size={14} />, requiredCapability: "supportsMavlinkSigning", section: "Security" },
  { id: "firmware", label: "Firmware", icon: <Zap size={14} />, requiredCapability: "supportsFirmwareFlash", section: "System" },
  { id: "cli", label: "CLI", icon: <Terminal size={14} />, requiredCapability: "supportsCliShell", section: "System", labelOverride: { px4: "Shell" } },
  // Debug
  { id: "mavlink", label: "MAVLink Inspector", icon: <Monitor size={14} />, requiredCapability: "supportsMavlinkInspector", section: "Debug" },
  { id: "blackbox", label: "Blackbox", icon: <HardDrive size={14} />, requiredCapability: "supportsBlackbox", section: "Debug" },
  { id: "debug", label: "Debug", icon: <Bug size={14} />, requiredCapability: "supportsDebugValues", section: "Debug" },
  { id: "diagnostics", label: "Diagnostics", icon: <Stethoscope size={14} />, section: "Debug" },
  { id: "logs", label: "Log Analysis", icon: <BarChart3 size={14} />, section: "Debug" },
  { id: "can", label: "DroneCAN", icon: <Network size={14} />, requiredCapability: "supportsCanFrame", section: "Debug" },
  // Programming — ArduPilot onboard Lua scripting (APM/scripts/ over MAVLink
  // FTP). ArduPilot-only; Betaflight/iNav have no Lua VM and PX4's scripting is
  // separate. Excluded by firmware (not a capability) so it stays forward-
  // compatible if another firmware gains scripting.
  { id: "scripts", label: "Scripts", icon: <ScrollText size={14} />, excludeFirmware: ["px4", "betaflight", "inav"], section: "Programming" },
  // iNav-specific
  { id: "inav-nav-config", label: "Navigation Config", icon: <MapPin size={14} />, requiredCapability: "supportsSettings", section: "Flight" },
  { id: "inav-mission", label: "iNav Mission", icon: <MapPin size={14} />, requiredCapability: "supportsMultiMission", section: "Flight" },
  { id: "inav-mixer-profile", label: "Mixer Profiles", icon: <Cpu size={14} />, requiredCapability: "supportsMixerProfile", section: "Flight" },
  { id: "inav-output-mapping", label: "Output Mapping", icon: <Cpu size={14} />, requiredCapability: "supportsOutputMappingExt", section: "Flight" },
  { id: "inav-servos", label: "Servos (iNav)", icon: <Sliders size={14} />, requiredCapability: "supportsServoMixer", section: "Flight" },
  { id: "inav-failsafe", label: "Failsafe (iNav)", icon: <ShieldAlert size={14} />, requiredCapability: "supportsSettings", section: "Safety" },
  { id: "inav-battery-profile", label: "Battery Profiles", icon: <Battery size={14} />, requiredCapability: "supportsBatteryProfile", section: "Sensors" },
  { id: "inav-temp-sensors", label: "Temp Sensors", icon: <Gauge size={14} />, requiredCapability: "supportsTempSensors", section: "Sensors" },
  { id: "inav-control-profile", label: "Control Profiles", icon: <Activity size={14} />, requiredCapability: "supportsSettings", section: "Tuning" },
  { id: "inav-mc-braking", label: "MC Braking", icon: <Activity size={14} />, requiredCapability: "supportsMcBraking", section: "Tuning" },
  { id: "inav-rate-dynamics", label: "Rate Dynamics", icon: <Activity size={14} />, requiredCapability: "supportsRateDynamics", section: "Tuning" },
  { id: "inav-ez-tune", label: "EZ Tune", icon: <Sliders size={14} />, requiredCapability: "supportsEzTune", section: "Tuning" },
  { id: "inav-fw-approach", label: "FW Approach", icon: <MapPin size={14} />, requiredCapability: "supportsFwApproach", section: "Flight" },
  { id: "inav-osd", label: "OSD (iNav)", icon: <Layers size={14} />, requiredCapability: "supportsCustomOsd", section: "Display" },
  { id: "inav-custom-osd", label: "Custom OSD", icon: <Monitor size={14} />, requiredCapability: "supportsCustomOsd", section: "Display" },
  { id: "displayport-osd", label: "OSD Preview", icon: <Monitor size={14} />, requiredCapability: "supportsDisplayPort", section: "Display" },
  { id: "inav-logic-conditions", label: "Logic Conditions", icon: <Zap size={14} />, requiredCapability: "supportsLogicConditions", section: "Programming" },
  { id: "inav-global-variables", label: "Global Variables", icon: <Activity size={14} />, requiredCapability: "supportsGlobalVariables", section: "Programming" },
  { id: "inav-programming-pid", label: "Programming PIDs", icon: <Sliders size={14} />, requiredCapability: "supportsProgrammingPid", section: "Programming" },
  { id: "inav-js-programming", label: "Programming (JS)", icon: <Braces size={14} />, requiredCapability: "supportsLogicConditions", section: "Programming" },
  { id: "inav-nav-pid", label: "Nav PID", icon: <Activity size={14} />, requiredCapability: "supportsSettings", section: "Tuning" },
];
