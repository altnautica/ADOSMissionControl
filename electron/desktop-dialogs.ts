/**
 * Native dialog wording and choice logic for the desktop shell, kept free of
 * Electron imports so it can be tested on its own.
 */

/** The fields of an Electron `BluetoothDevice` the chooser reads. */
export interface BluetoothDeviceLike {
  deviceId: string;
  deviceName?: string;
}

/** Button labels for the Bluetooth chooser, one per device. */
export function bluetoothChoiceLabels(devices: readonly BluetoothDeviceLike[]): string[] {
  return devices.map((device) => device.deviceName?.trim() || device.deviceId || "Unknown Bluetooth device");
}

/** Shows the device list and returns the chosen index, or -1 for Cancel. */
export type BluetoothChoicePrompt = (labels: string[]) => number;

export interface BluetoothChooserOptions {
  /** Time to collect devices after the scan starts before asking. */
  settleMs?: number;
  /** Give up with Cancel when nothing was found within this time. */
  giveUpMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/**
 * Handles Electron's `select-bluetooth-device`, which fires again every time
 * the scan finds another device. Without a handler Electron picks the first
 * device that answers. This collects devices for `settleMs`, then asks the
 * operator once; the request is cancelled when nothing is found by `giveUpMs`
 * or the operator presses Cancel.
 */
export function createBluetoothChooser(prompt: BluetoothChoicePrompt, options: BluetoothChooserOptions = {}) {
  const settleMs = options.settleMs ?? 2000;
  const giveUpMs = options.giveUpMs ?? 15000;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));

  let pending: {
    devices: BluetoothDeviceLike[];
    callback: (deviceId: string) => void;
    waitedMs: number;
  } | null = null;

  const decide = () => {
    const request = pending;
    if (!request) return;
    if (request.devices.length === 0) {
      if (request.waitedMs >= giveUpMs) {
        pending = null;
        request.callback("");
        return;
      }
      request.waitedMs += settleMs;
      setTimer(decide, settleMs);
      return;
    }
    pending = null;
    const index = prompt(bluetoothChoiceLabels(request.devices));
    request.callback(index >= 0 && index < request.devices.length ? request.devices[index].deviceId : "");
  };

  return (devices: readonly BluetoothDeviceLike[], callback: (deviceId: string) => void) => {
    if (pending) {
      pending.devices = [...devices];
      pending.callback = callback;
      return;
    }
    pending = { devices: [...devices], callback, waitedMs: settleMs };
    setTimer(decide, settleMs);
  };
}

/** Chromium's code for a load the app itself replaced or stopped. */
const ERR_ABORTED = -3;

/** Whether a `did-fail-load` should put the failure dialog in front of the operator. */
export function shouldReportLoadFailure(errorCode: number, isMainFrame: boolean): boolean {
  return isMainFrame && errorCode !== ERR_ABORTED;
}

/** The message box shown when the app page fails to load. Button 0 retries, 1 quits. */
export function loadFailureDialog(errorDescription: string) {
  return {
    type: "error" as const,
    title: "ADOS Mission Control",
    message: "ADOS Mission Control could not load its window.",
    detail: `The app page did not load (${errorDescription || "unknown error"}). Retry to load it again, or quit and restart the app.`,
    buttons: ["Retry", "Quit"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}

/** Title and body of the box shown when startup fails. The stack goes to the log, not the box. */
export function startupFailureBox(reason: string, logFile: string | null) {
  const where = logFile
    ? `The details are in the log file:\n${logFile}`
    : "The details could not be written to a log file.";
  return {
    title: "ADOS Mission Control could not start",
    content: `The app's built-in server did not start (${reason}).\n\n${where}\n\nInclude that file when you report this.`,
  };
}
