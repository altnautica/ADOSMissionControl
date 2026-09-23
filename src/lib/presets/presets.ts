// lib/presets/presets.ts — 7 build preset definitions for Command GCS
// SPDX-License-Identifier: GPL-3.0-only

import type { BuildPreset, PresetCategory } from "./types";

const PRESETS: BuildPreset[] = [
  {
    id: "5in-fpv-freestyle",
    name: '5" FPV Freestyle',
    description: "Aggressive 5-inch freestyle quad. No GPS, no nav sensors. Short flight time, high agility.",
    category: "fpv",
    specs: {
      propSize: '5"', motorSize: "2306", motorKv: 2450, cells: 6,
      batteryMah: 1100, auwGrams: 680, flightTimeMin: 5,
      hasGps: false, hasCompass: false, hasRangefinder: false, hasCompute: false,
    },
    components: [
      { type: "frame", name: "5\" Freestyle Frame", count: 1, details: { wheelbase: "220mm", weight: "110g" } },
      { type: "fc", name: "STM32H743 FC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M7 480MHz" } },
      { type: "esc", name: "4-in-1 ESC 45A", count: 1, details: { current: "45A", protocol: "DShot600" } },
      { type: "motor", name: "2306 2450KV", count: 4, details: { kv: "2450", size: "2306" } },
      { type: "battery", name: "LiPo 6S 1100mAh", count: 1, details: { cells: "6S", capacity: "1100mAh", voltage: "22.2V" } },
      { type: "camera", name: "FPV Camera", count: 1, details: { resolution: "1200TVL", fov: "160°" } },
      { type: "radio", name: "Video TX", count: 1, details: { power: "600mW", band: "5.8GHz" } },
      { type: "sensor", name: "ICM-42688-P IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
    ],
  },
  {
    id: "7in-long-range",
    name: '7" Long Range',
    description: "GPS-equipped 7-inch long-range quad. Li-Ion battery for 30+ min flight.",
    category: "long-range",
    specs: {
      propSize: '7"', motorSize: "2806.5", motorKv: 1300, cells: 6,
      batteryMah: 4200, auwGrams: 850, flightTimeMin: 30,
      hasGps: true, hasCompass: true, hasRangefinder: false, hasCompute: false,
    },
    components: [
      { type: "frame", name: "7\" LR Frame", count: 1, details: { wheelbase: "320mm", weight: "180g" } },
      { type: "fc", name: "STM32H743 FC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M7 480MHz" } },
      { type: "esc", name: "4-in-1 ESC 35A", count: 1, details: { current: "35A", protocol: "DShot600" } },
      { type: "motor", name: "2806.5 1300KV", count: 4, details: { kv: "1300", size: "2806.5" } },
      { type: "battery", name: "Li-Ion 6S 4200mAh", count: 1, details: { cells: "6S", capacity: "4200mAh", voltage: "22.2V", chemistry: "Li-Ion" } },
      { type: "gps", name: "u-blox M10 GPS", count: 1, details: { type: "GNSS", constellations: "GPS+GLONASS+BDS+Galileo" } },
      { type: "sensor", name: "ICM-42688-P IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
      { type: "sensor", name: "BMP390 Barometer", count: 1, details: { type: "Barometer" } },
      { type: "sensor", name: "IST8310 Compass", count: 1, details: { type: "Magnetometer" } },
      { type: "camera", name: "FPV Camera", count: 1, details: { resolution: "1200TVL", fov: "145°" } },
      { type: "radio", name: "Video TX", count: 1, details: { power: "1000mW", band: "5.8GHz" } },
    ],
  },
  {
    id: "10in-heavy-lifter",
    name: '10" Heavy Lift Hexa',
    description: "6-motor heavy lifter with GPS, compass, and rangefinder. Conservative nav speeds.",
    category: "heavy-lift",
    specs: {
      propSize: '10"', motorSize: "3110", motorKv: 900, cells: 6,
      batteryMah: 10000, auwGrams: 3500, flightTimeMin: 20,
      hasGps: true, hasCompass: true, hasRangefinder: true, hasCompute: false,
    },
    components: [
      { type: "frame", name: '10" Hexa Frame', count: 1, details: { wheelbase: "550mm", weight: "600g", motors: "6" } },
      { type: "fc", name: "STM32H743 FC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M7 480MHz" } },
      { type: "esc", name: "ESC 40A", count: 6, details: { current: "40A", protocol: "DShot600" } },
      { type: "motor", name: "3110 900KV", count: 6, details: { kv: "900", size: "3110" } },
      { type: "battery", name: "LiPo 6S 10000mAh", count: 1, details: { cells: "6S", capacity: "10000mAh", voltage: "22.2V" } },
      { type: "gps", name: "u-blox M10 GPS", count: 1, details: { type: "GNSS", constellations: "GPS+GLONASS+BDS+Galileo" } },
      { type: "sensor", name: "ICM-42688-P IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
      { type: "sensor", name: "ICM-20649 IMU Backup", count: 1, details: { type: "IMU Backup", axes: "6-axis" } },
      { type: "sensor", name: "BMP390 Barometer", count: 1, details: { type: "Barometer" } },
      { type: "sensor", name: "IST8310 Compass", count: 1, details: { type: "Magnetometer" } },
      { type: "rangefinder", name: "TFmini-S LiDAR", count: 1, details: { type: "Rangefinder", range: "12m" } },
      { type: "radio", name: "Video TX", count: 1, details: { power: "1000mW", band: "5.8GHz" } },
    ],
  },
  {
    id: "3in-cinewhoop",
    name: '3" Cinewhoop',
    description: "Ducted 3-inch cinewhoop. Slow nav speeds, indoor-safe. Smooth cinema flight.",
    category: "cine",
    specs: {
      propSize: '3"', motorSize: "1404", motorKv: 4500, cells: 4,
      batteryMah: 850, auwGrams: 250, flightTimeMin: 6,
      hasGps: false, hasCompass: false, hasRangefinder: false, hasCompute: false,
    },
    components: [
      { type: "frame", name: '3" Cinewhoop Ducted Frame', count: 1, details: { wheelbase: "140mm", weight: "65g", ducted: "yes" } },
      { type: "fc", name: "STM32F405 FC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M4 168MHz" } },
      { type: "esc", name: "4-in-1 ESC 25A", count: 1, details: { current: "25A", protocol: "DShot300" } },
      { type: "motor", name: "1404 4500KV", count: 4, details: { kv: "4500", size: "1404" } },
      { type: "battery", name: "LiPo 4S 850mAh", count: 1, details: { cells: "4S", capacity: "850mAh", voltage: "14.8V" } },
      { type: "camera", name: "Naked Action Cam", count: 1, details: { resolution: "4K", fov: "155°" } },
      { type: "radio", name: "Video TX", count: 1, details: { power: "400mW", band: "5.8GHz" } },
      { type: "sensor", name: "BMI270 IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
    ],
  },
  {
    id: "xclass-racer",
    name: "X-Class Racer",
    description: "13-inch prop X-Class racing quad. High speed, GPS for RTL safety.",
    category: "racing",
    specs: {
      propSize: '13"', motorSize: "4014", motorKv: 400, cells: 6,
      batteryMah: 3000, auwGrams: 3200, flightTimeMin: 8,
      hasGps: true, hasCompass: false, hasRangefinder: false, hasCompute: false,
    },
    components: [
      { type: "frame", name: "X-Class Race Frame", count: 1, details: { wheelbase: "775mm", weight: "800g" } },
      { type: "fc", name: "STM32H743 FC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M7 480MHz" } },
      { type: "esc", name: "ESC 80A", count: 4, details: { current: "80A", protocol: "DShot600" } },
      { type: "motor", name: "4014 400KV", count: 4, details: { kv: "400", size: "4014" } },
      { type: "battery", name: "LiPo 6S 3000mAh", count: 1, details: { cells: "6S", capacity: "3000mAh", voltage: "22.2V" } },
      { type: "gps", name: "u-blox M10 GPS", count: 1, details: { type: "GNSS" } },
      { type: "sensor", name: "ICM-42688-P IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
      { type: "sensor", name: "BMP390 Barometer", count: 1, details: { type: "Barometer" } },
      { type: "camera", name: "FPV Camera", count: 1, details: { resolution: "1200TVL", fov: "170°" } },
      { type: "radio", name: "Video TX", count: 1, details: { power: "800mW", band: "5.8GHz" } },
    ],
  },
  {
    id: "tiny-whoop",
    name: "Tiny Whoop",
    description: "Sub-100g micro whoop. 65mm frame, 1S battery. Indoor only, no sensors.",
    category: "micro",
    specs: {
      propSize: '1.5"', motorSize: "0802", motorKv: 19000, cells: 1,
      batteryMah: 450, auwGrams: 28, flightTimeMin: 4,
      hasGps: false, hasCompass: false, hasRangefinder: false, hasCompute: false,
    },
    components: [
      { type: "frame", name: "65mm Whoop Frame", count: 1, details: { wheelbase: "65mm", weight: "8g", ducted: "yes" } },
      { type: "fc", name: "STM32F411 AIO FC+ESC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M4 100MHz" } },
      { type: "motor", name: "0802 19000KV", count: 4, details: { kv: "19000", size: "0802" } },
      { type: "battery", name: "LiPo 1S 450mAh", count: 1, details: { cells: "1S", capacity: "450mAh", voltage: "3.7V" } },
      { type: "camera", name: "Micro FPV Camera", count: 1, details: { resolution: "700TVL", fov: "120°" } },
      { type: "radio", name: "Video TX 25mW", count: 1, details: { power: "25mW", band: "5.8GHz" } },
      { type: "sensor", name: "BMI270 IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
    ],
  },
  {
    id: "7in-ados-reference",
    name: '7" ADOS Reference',
    description: "Altnautica reference build. CM4 compute, full sensor suite, rangefinder, WFB-ng video, 4G telemetry.",
    category: "reference",
    specs: {
      propSize: '7"', motorSize: "2806.5", motorKv: 1300, cells: 6,
      batteryMah: 4200, auwGrams: 855, flightTimeMin: 30,
      hasGps: true, hasCompass: true, hasRangefinder: true, hasCompute: true,
    },
    components: [
      { type: "frame", name: "Chimera7 Pro V2", count: 1, details: { wheelbase: "320mm", weight: "180g", size: '7"' } },
      { type: "compute", name: "Raspberry Pi CM4", count: 1, details: { cpu: "BCM2711", ram: "4GB", storage: "32GB eMMC" } },
      { type: "fc", name: "STM32H743 FC", count: 1, details: { firmware: "ArduPilot 4.5", mcu: "Cortex-M7 480MHz" } },
      { type: "esc", name: "4-in-1 ESC 35A", count: 1, details: { current: "35A", protocol: "DShot600" } },
      { type: "motor", name: "2806.5 1300KV", count: 4, details: { kv: "1300", size: "2806.5" } },
      { type: "battery", name: "Li-Ion 6S 4200mAh", count: 1, details: { cells: "6S", capacity: "4200mAh", voltage: "22.2V", chemistry: "Li-Ion" } },
      { type: "gps", name: "u-blox M10 GPS", count: 1, details: { type: "GNSS", constellations: "GPS+GLONASS+BDS+Galileo" } },
      { type: "sensor", name: "ICM-42688-P IMU", count: 1, details: { type: "IMU", axes: "6-axis" } },
      { type: "sensor", name: "ICM-20649 IMU Backup", count: 1, details: { type: "IMU Backup", axes: "6-axis" } },
      { type: "sensor", name: "BMP390 Barometer", count: 1, details: { type: "Barometer" } },
      { type: "sensor", name: "IST8310 Compass", count: 1, details: { type: "Magnetometer" } },
      { type: "rangefinder", name: "TFmini-S LiDAR", count: 1, details: { type: "Rangefinder", range: "12m" } },
      { type: "camera", name: "IMX462 Main Camera", count: 1, details: { resolution: "1080p", fov: "120°", sensor: '1/2.8"' } },
      { type: "camera", name: "FLIR Lepton 3.5", count: 1, details: { resolution: "160x120", type: "Thermal" } },
      { type: "radio", name: "RTL8812EU WFB-ng", count: 1, details: { protocol: "WFB-ng", band: "5.8GHz", power: "29dBm" } },
      { type: "radio", name: "4G LTE Module", count: 1, details: { type: "4G LTE" } },
    ],
  },
];

/** Get a preset by ID. */
export function getPreset(id: string): BuildPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** List all available presets. */
export function listPresets(): BuildPreset[] {
  return PRESETS;
}

/** All distinct categories. */
export function listCategories(): PresetCategory[] {
  return [...new Set(PRESETS.map((p) => p.category))];
}
