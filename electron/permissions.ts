import { BrowserWindow, dialog, session } from "electron";

/** Sony's USB vendor id: the only HID devices the app asks for (DS4 lightbar). */
export const SONY_HID_VENDOR = 0x054c;

export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "serial",
  "usb",
  // WebHID: the controller settings drive a DualShock 4 lightbar and rumble.
  "hid",
  // Immersive cockpit keeps the display awake with the Screen Wake Lock API.
  "screen-wake-lock",
  // Operator position. `geolocation` was ABSENT, so `setPermissionCheckHandler`
  // reported `denied` and `setPermissionRequestHandler` denied
  // unconditionally — no OS prompt was ever shown — and Follow Me, which
  // streams operator GPS to the aircraft via `guidedGoto()` at 4 Hz, was dead
  // on the desktop build ONLY. The browser build works because
  // `next.config.ts` sets `geolocation=(self)`. It is still origin-gated to
  // the app's own loopback window, and the OS keeps its own prompt in front
  // of the actual hardware.
  "geolocation",
  // Local Network Access. Chromium gates a page's access to loopback and
  // private (RFC1918 / .local) endpoints behind a permission, and that gate was
  // extended to cover WebSocket and WebTransport, not just fetch/XHR. Reaching
  // a drone agent by LAN IP or `<host>.local` — the default and correct
  // topology for this GCS — is exactly what it targets, so without these
  // entries both handlers below deny every agent request and the operator sees
  // a network outage rather than a permission denial. Electron exposes the
  // split `local-network` / `loopback-network` pair plus the legacy combined
  // `local-network-access` spelling, and which one a given Chromium asks for
  // depends on its version, so all three are accepted. Still origin-gated:
  // only the app's own loopback origin is granted anything.
  "local-network",
  "loopback-network",
  "local-network-access",
]);

/** Whether `origin` is exactly the app's own server, `http://127.0.0.1:<port>`. */
export function isTrustedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === `http://127.0.0.1:${port}`;
  } catch {
    return false;
  }
}

function getOwnerWindow(webContents: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(webContents);
}

/**
 * Setup device permissions for WebSerial and WebUSB.
 * Electron requires explicit permission handling for these APIs. Every grant
 * is limited to the app's own origin on `port`; another loopback origin (a
 * different local server rendered in a frame) gets nothing.
 */
export function setupPermissions(port: number): void {
  const ses = session.defaultSession;

  ses.setDevicePermissionHandler((details) => {
    return isTrustedOrigin(details.origin, port);
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isTrustedOrigin(requestingOrigin, port);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = webContents.getURL();
    try {
      if (details.requestingUrl) origin = new URL(details.requestingUrl).origin;
    } catch {
      origin = "";
    }
    callback(ALLOWED_PERMISSIONS.has(permission) && isTrustedOrigin(origin, port));
  });

  ses.on("select-serial-port", (event, portList, webContents, callback) => {
    event.preventDefault();

    if (portList.length === 0) {
      callback("");
      return;
    }

    const labels = portList.map((port) =>
      port.displayName || port.portName || port.portId || "Unknown serial port",
    );
    const ownerWindow = getOwnerWindow(webContents);
    const options: Electron.MessageBoxSyncOptions = {
      type: "question",
      title: "Select serial device",
      message: "Choose the serial device Mission Control should use.",
      buttons: [...labels, "Cancel"],
      cancelId: labels.length,
      defaultId: labels.length,
      noLink: true,
    };
    const selection = ownerWindow
      ? dialog.showMessageBoxSync(ownerWindow, options)
      : dialog.showMessageBoxSync(options);

    if (selection >= 0 && selection < portList.length) {
      callback(portList[selection].portId);
      return;
    }

    callback("");
  });

  // Handle WebUSB device selection
  ses.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();

    if (details.deviceList.length === 0) {
      callback();
      return;
    }

    const labels = details.deviceList.map((device) =>
      device.productName || device.manufacturerName || device.deviceId || "Unknown USB device",
    );
    const selection = dialog.showMessageBoxSync({
      type: "question",
      title: "Select USB device",
      message: "Choose the USB device Mission Control should use.",
      buttons: [...labels, "Cancel"],
      cancelId: labels.length,
      defaultId: labels.length,
      noLink: true,
    });

    if (selection >= 0 && selection < details.deviceList.length) {
      callback(details.deviceList[selection].deviceId);
      return;
    }

    callback();
  });

  // WebHID device selection: without a handler Electron grants nothing and
  // the DS4 lightbar never connects. Only Sony controllers are offered.
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const devices = sonyHidDevices(details.deviceList);
    if (devices.length === 0) {
      callback();
      return;
    }
    const labels = devices.map((device) => device.name || device.deviceId);
    const selection = dialog.showMessageBoxSync({
      type: "question",
      title: "Select controller",
      message: "Choose the controller Mission Control should use.",
      buttons: [...labels, "Cancel"],
      cancelId: labels.length,
      defaultId: 0,
      noLink: true,
    });
    callback(selection >= 0 && selection < devices.length ? devices[selection].deviceId : undefined);
  });
}

/** The HID devices the chooser offers: Sony controllers only. */
export function sonyHidDevices<T extends { vendorId: number }>(list: readonly T[]): T[] {
  return list.filter((device) => device.vendorId === SONY_HID_VENDOR);
}
