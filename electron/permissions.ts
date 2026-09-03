import { BrowserWindow, dialog, session } from "electron";

const ALLOWED_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "media",
  "notifications",
  "serial",
  "usb",
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
  // `isTrustedOrigin` keeps this to the app's own loopback window.
  "local-network",
  "loopback-network",
  "local-network-access",
]);

function isTrustedOrigin(origin?: string): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function getOwnerWindow(webContents: Electron.WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(webContents);
}

/**
 * Setup device permissions for WebSerial and WebUSB.
 * Electron requires explicit permission handling for these APIs.
 */
export function setupPermissions(): void {
  const ses = session.defaultSession;

  ses.setDevicePermissionHandler((details) => {
    return isTrustedOrigin(details.origin);
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isTrustedOrigin(requestingOrigin);
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = webContents.getURL();
    try {
      if (details.requestingUrl) origin = new URL(details.requestingUrl).origin;
    } catch {
      origin = "";
    }
    callback(ALLOWED_PERMISSIONS.has(permission) && isTrustedOrigin(origin));
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
}
