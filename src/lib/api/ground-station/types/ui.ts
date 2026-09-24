/**
 * @module api/ground-station/types/ui
 * @description Physical UI types: OLED panel config, button bindings,
 * screen rotation, HDMI display, Bluetooth devices, gamepads, and the
 * factory-reset surface.
 *
 * @license GPL-3.0-only
 */

export interface OledConfig {
  brightness: number;
  auto_dim_enabled: boolean;
  screen_cycle_seconds: number;
}

export interface ButtonBinding {
  short_press?: string;
  long_press?: string;
}

export interface ButtonsConfig {
  [buttonId: string]: ButtonBinding;
}

export interface ScreensConfig {
  order: string[];
  enabled: string[];
}

export interface UiConfig {
  oled: OledConfig;
  buttons: ButtonsConfig;
  screens: ScreensConfig;
}

export interface OledUpdate {
  brightness?: number;
  auto_dim_enabled?: boolean;
  screen_cycle_seconds?: number;
}

export interface ScreensUpdate {
  order?: string[];
  enabled?: string[];
}

export interface FactoryResetResult {
  reset: boolean;
  timestamp: string;
}

// Display
export interface DisplayConfig {
  resolution: string;
  kiosk_enabled: boolean;
}

export interface DisplayUpdate {
  resolution?: string;
  kiosk_enabled?: boolean;
}

// Bluetooth
export interface BluetoothDevice {
  mac: string;
  name: string;
  rssi_dbm?: number | null;
  paired?: boolean;
  /** Measured per device; null when bluetoothctl did not answer (unknown,
   * never "disconnected"). */
  connected?: boolean | null;
}

export interface BluetoothScanResult {
  devices: BluetoothDevice[];
}

export interface BluetoothPairResult {
  paired: boolean;
  mac: string;
  name?: string | null;
}

export interface BluetoothForgetResult {
  forgotten: boolean;
  mac: string;
}

export interface BluetoothPairedList {
  devices: BluetoothDevice[];
}

// Gamepads
export interface Gamepad {
  device_id: string;
  name: string;
  type: "usb" | "bluetooth" | "unknown";
  connected: boolean;
  is_primary?: boolean;
}

export interface GamepadList {
  devices: Gamepad[];
  primary_id: string | null;
}

export interface GamepadPrimaryUpdate {
  primary_id: string | null;
}
