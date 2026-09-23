// HDMI display, Bluetooth scan/pair/forget, gamepads, and the generic peripheral plugin manager.

import type {
  BluetoothForgetResult,
  BluetoothPairedList,
  BluetoothPairResult,
  BluetoothScanResult,
  DisplayConfig,
  DisplayUpdate,
  GamepadList,
  PeripheralDetail,
  PeripheralListResponse,
} from "./types";
import { gsRequest, type RequestContext } from "./request";

// --- Display ---

export function getDisplay(ctx: RequestContext): Promise<DisplayConfig> {
  return gsRequest<DisplayConfig>(ctx, "/api/v1/ground-station/display");
}

export function setDisplay(ctx: RequestContext, update: DisplayUpdate): Promise<DisplayConfig> {
  return gsRequest<DisplayConfig>(ctx, "/api/v1/ground-station/display", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

// --- Bluetooth ---

export function scanBluetooth(
  ctx: RequestContext,
  durationS = 10,
): Promise<BluetoothScanResult> {
  return gsRequest<BluetoothScanResult>(ctx, "/api/v1/ground-station/bluetooth/scan", {
    method: "POST",
    body: JSON.stringify({ duration_s: durationS }),
  });
}

export function pairBluetooth(ctx: RequestContext, mac: string): Promise<BluetoothPairResult> {
  return gsRequest<BluetoothPairResult>(ctx, "/api/v1/ground-station/bluetooth/pair", {
    method: "POST",
    body: JSON.stringify({ mac }),
  });
}

export function forgetBluetooth(
  ctx: RequestContext,
  mac: string,
): Promise<BluetoothForgetResult> {
  const encoded = encodeURIComponent(mac);
  return gsRequest<BluetoothForgetResult>(
    ctx,
    `/api/v1/ground-station/bluetooth/${encoded}`,
    { method: "DELETE" },
  );
}

export function getPairedBluetooth(ctx: RequestContext): Promise<BluetoothPairedList> {
  return gsRequest<BluetoothPairedList>(ctx, "/api/v1/ground-station/bluetooth/paired");
}

// --- Gamepads ---

export function listGamepads(ctx: RequestContext): Promise<GamepadList> {
  return gsRequest<GamepadList>(ctx, "/api/v1/ground-station/gamepads");
}

/** Select the primary gamepad (ados-control `gs_gamepad_write.rs`
 * GamepadPrimaryUpdate: a required, non-empty `device_id`; there is no clear
 * operation). The reply is `{primary_id, result}` and carries no device list,
 * so callers reload the list with `listGamepads`. */
export function setPrimaryGamepad(
  ctx: RequestContext,
  deviceId: string,
): Promise<{ primary_id: string; result: unknown }> {
  return gsRequest(ctx, "/api/v1/ground-station/gamepads/primary", {
    method: "PUT",
    body: JSON.stringify({ device_id: deviceId }),
  });
}

// --- Peripheral Manager ---

/**
 * Lists all registered peripheral plugins.
 * Empty-state response is {peripherals: [], count: 0} when no plugins are registered.
 */
export function listPeripherals(ctx: RequestContext): Promise<PeripheralListResponse> {
  return gsRequest<PeripheralListResponse>(ctx, "/api/v1/peripherals");
}

export function getPeripheral(ctx: RequestContext, id: string): Promise<PeripheralDetail> {
  return gsRequest<PeripheralDetail>(
    ctx,
    `/api/v1/peripherals/${encodeURIComponent(id)}`,
  );
}

export function configurePeripheral(
  ctx: RequestContext,
  id: string,
  config: Record<string, unknown>,
): Promise<{ saved: boolean }> {
  return gsRequest<{ saved: boolean }>(
    ctx,
    `/api/v1/peripherals/${encodeURIComponent(id)}/config`,
    {
      method: "POST",
      body: JSON.stringify(config),
    },
  );
}

export function invokePeripheralAction(
  ctx: RequestContext,
  id: string,
  actionId: string,
  body?: Record<string, unknown>,
): Promise<{ queued: boolean; result?: unknown }> {
  return gsRequest<{ queued: boolean; result?: unknown }>(
    ctx,
    `/api/v1/peripherals/${encodeURIComponent(id)}/action`,
    {
      method: "POST",
      body: JSON.stringify({ action_id: actionId, body: body ?? {} }),
    },
  );
}
