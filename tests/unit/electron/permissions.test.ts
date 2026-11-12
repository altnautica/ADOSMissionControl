/**
 * Desktop permission grants: wake lock and WebHID for the app origin, and a
 * HID chooser that offers only Sony controllers.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;
const { handlers, events, showMessageBoxSync } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  events: new Map<string, Handler>(),
  showMessageBoxSync: vi.fn(() => 0),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBoxSync },
  session: {
    defaultSession: {
      setDevicePermissionHandler: (h: Handler) => handlers.set("device", h),
      setPermissionCheckHandler: (h: Handler) => handlers.set("check", h),
      setPermissionRequestHandler: (h: Handler) => handlers.set("request", h),
      on: (name: string, h: Handler) => events.set(name, h),
    },
  },
}));

import { setupPermissions, sonyHidDevices } from "../../../electron/permissions";

const PORT = 4123;
setupPermissions(PORT);
const check = (permission: string, origin = `http://127.0.0.1:${PORT}`) =>
  handlers.get("check")!(null, permission, origin);

describe("permission check", () => {
  it.each(["screen-wake-lock", "hid"])("grants %s to the app origin", (permission) => {
    expect(check(permission)).toBe(true);
  });

  it("refuses them to another origin", () => {
    expect(check("hid", "http://127.0.0.1:9999")).toBe(false);
  });
});

describe("HID chooser", () => {
  const sony = { deviceId: "a", name: "Wireless Controller", vendorId: 0x054c };
  const other = { deviceId: "b", name: "Keyboard", vendorId: 0x046d };

  it("filters to Sony controllers", () => {
    expect(sonyHidDevices([sony, other])).toEqual([sony]);
  });

  it("hands back the picked controller", () => {
    const callback = vi.fn();
    events.get("select-hid-device")!({ preventDefault() {} }, { deviceList: [other, sony] }, callback);
    expect(callback).toHaveBeenCalledWith("a");
  });

  it("selects nothing when no controller is present", () => {
    const callback = vi.fn();
    events.get("select-hid-device")!({ preventDefault() {} }, { deviceList: [other] }, callback);
    expect(callback).toHaveBeenCalledWith();
  });
});
