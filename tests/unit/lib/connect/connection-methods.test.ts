/**
 * Bluetooth availability per surface: the desktop app on a platform with no
 * Web Bluetooth says so instead of pointing at Chrome or Edge.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const env = vi.hoisted(() => ({ electron: false, ble: false }));

vi.mock("@/lib/utils", () => ({ isElectron: () => env.electron }));
vi.mock("@/lib/protocol/transport/webserial", () => ({
  WebSerialTransport: { isSupported: () => true },
}));
vi.mock("@/lib/protocol/transport/ble", () => ({
  BluetoothTransport: { isSupported: () => env.ble },
}));

import { getDirectConnectionMethods } from "@/lib/connect/connection-methods";

const bluetooth = () => getDirectConnectionMethods().find((m) => m.id === "bluetooth")!;

describe("bluetooth availability", () => {
  beforeEach(() => {
    env.electron = false;
    env.ble = false;
  });

  it("is desktop-unsupported in the desktop app without Web Bluetooth", () => {
    env.electron = true;
    expect(bluetooth().availability).toBe("desktop-unsupported");
  });

  it("asks for Chrome or Edge in a browser without Web Bluetooth", () => {
    expect(bluetooth().availability).toBe("chromium-only");
  });

  it("is available wherever Web Bluetooth exists", () => {
    env.electron = true;
    env.ble = true;
    expect(bluetooth().availability).toBe("available");
  });
});
