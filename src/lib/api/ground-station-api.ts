/**
 * @module GroundStationApi
 * @description Typed REST client for the ADOS Ground Agent HTTP surface.
 * Phase 0: status, wfb GET/PUT.
 * Phase 1 (Wave D): network, pair, UI, factory-reset.
 * Phase 2 (Wave C): display, bluetooth, gamepads, pic (with WebSocket events).
 * @license GPL-3.0-only
 */

import type {
  GroundStationLinkHealth,
  GroundStationStatus as GroundStationStatusState,
  WfbConfig,
} from "@/stores/ground-station-store";

export interface GroundStationStatusResponse extends GroundStationStatusState {
  link_health?: Partial<GroundStationLinkHealth>;
}

// Network types
export interface ApStatus {
  enabled: boolean;
  ssid: string;
  passphrase: string;
  channel: number;
  connected_clients?: number | null;
}

export interface WifiClientStatus {
  available: boolean;
  ssid?: string | null;
  rssi_dbm?: number | null;
}

export interface ModemStatus {
  available: boolean;
  carrier?: string | null;
  signal_bars?: number | null;
}

export interface NetworkStatus {
  ap: ApStatus;
  wifi_client: WifiClientStatus;
  modem: ModemStatus;
}

export interface ApUpdate {
  enabled?: boolean;
  ssid?: string;
  passphrase?: string;
  channel?: number;
}

// Pair types
export interface PairResult {
  paired_drone_id: string;
  paired_at: string;
  key_fingerprint: string;
}

export interface UnpairResult {
  unpaired: boolean;
  previous_drone_id: string | null;
}

// UI types
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

// Display (Phase 2, Wave C)
export interface DisplayConfig {
  resolution: string;
  kiosk_enabled: boolean;
}

export interface DisplayUpdate {
  resolution?: string;
  kiosk_enabled?: boolean;
}

// Bluetooth (Phase 2, Wave C)
export interface BluetoothDevice {
  mac: string;
  name: string;
  rssi_dbm?: number | null;
  paired?: boolean;
  connected?: boolean;
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

// Gamepads (Phase 2, Wave C)
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

// PIC (Pilot in Command) (Phase 2, Wave C)
export interface PicState {
  state: string;
  claimed_by: string | null;
  claim_counter: number;
  primary_gamepad_id: string | null;
}

export interface PicClaimResult {
  claimed: boolean;
  claimed_by: string | null;
  claim_counter: number;
  requires_confirm_token?: boolean;
}

export interface PicReleaseResult {
  released: boolean;
  claimed_by: string | null;
}

export interface PicConfirmTokenResult {
  confirm_token: string;
  expires_in_s: number;
}

export type PicEvent =
  | { type: "claimed"; claimed_by: string | null; claim_counter: number }
  | { type: "released"; claimed_by: string | null }
  | { type: "gamepad_changed"; primary_gamepad_id: string | null }
  | { type: "state"; state: string; claimed_by: string | null; claim_counter: number; primary_gamepad_id: string | null }
  | { type: string; [key: string]: unknown };

export class GroundStationApiError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(status: number, body: string, message?: string) {
    super(message ?? `Ground station API ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.name = "GroundStationApiError";
  }
}

export class GroundStationApi {
  private baseUrl: string;
  private apiKey: string | null;

  constructor(baseUrl: string, apiKey?: string | null) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey ?? null;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    };
    if (this.apiKey) {
      headers["X-ADOS-Key"] = this.apiKey;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new GroundStationApiError(res.status, text);
    }
    // Some endpoints (e.g. factory reset) may still return JSON; trust the agent.
    return res.json() as Promise<T>;
  }

  async getStatus(): Promise<GroundStationStatusResponse> {
    return this.request<GroundStationStatusResponse>("/api/v1/ground-station/status");
  }

  async getWfb(): Promise<WfbConfig> {
    return this.request<WfbConfig>("/api/v1/ground-station/wfb");
  }

  async setWfb(partial: Partial<WfbConfig>): Promise<WfbConfig> {
    return this.request<WfbConfig>("/api/v1/ground-station/wfb", {
      method: "PUT",
      body: JSON.stringify(partial),
    });
  }

  async getNetwork(): Promise<NetworkStatus> {
    return this.request<NetworkStatus>("/api/v1/ground-station/network");
  }

  async setAp(update: ApUpdate): Promise<ApStatus> {
    return this.request<ApStatus>("/api/v1/ground-station/network/ap", {
      method: "PUT",
      body: JSON.stringify(update),
    });
  }

  async pairDrone(pairKey: string, droneId?: string): Promise<PairResult> {
    const body: Record<string, string> = { pair_key: pairKey };
    if (droneId) body.drone_device_id = droneId;
    return this.request<PairResult>("/api/v1/ground-station/wfb/pair", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async unpairDrone(): Promise<UnpairResult> {
    return this.request<UnpairResult>("/api/v1/ground-station/wfb/pair", {
      method: "DELETE",
    });
  }

  async getUi(): Promise<UiConfig> {
    return this.request<UiConfig>("/api/v1/ground-station/ui");
  }

  async setOled(update: OledUpdate): Promise<UiConfig> {
    return this.request<UiConfig>("/api/v1/ground-station/ui/oled", {
      method: "PUT",
      body: JSON.stringify(update),
    });
  }

  async setButtons(mapping: Record<string, unknown>): Promise<UiConfig> {
    return this.request<UiConfig>("/api/v1/ground-station/ui/buttons", {
      method: "PUT",
      body: JSON.stringify(mapping),
    });
  }

  async setScreens(update: ScreensUpdate): Promise<UiConfig> {
    return this.request<UiConfig>("/api/v1/ground-station/ui/screens", {
      method: "PUT",
      body: JSON.stringify(update),
    });
  }

  async factoryReset(confirmToken: string): Promise<FactoryResetResult> {
    const q = encodeURIComponent(confirmToken);
    return this.request<FactoryResetResult>(
      `/api/v1/ground-station/factory-reset?confirm=${q}`,
      { method: "POST" },
    );
  }

  // ============================================================
  // Phase 2 (Wave C) — display, bluetooth, gamepads, pic
  // ============================================================

  async getDisplay(): Promise<DisplayConfig> {
    return this.request<DisplayConfig>("/api/v1/ground-station/display");
  }

  async setDisplay(update: DisplayUpdate): Promise<DisplayConfig> {
    return this.request<DisplayConfig>("/api/v1/ground-station/display", {
      method: "PUT",
      body: JSON.stringify(update),
    });
  }

  async scanBluetooth(durationS = 10): Promise<BluetoothScanResult> {
    return this.request<BluetoothScanResult>(
      "/api/v1/ground-station/bluetooth/scan",
      {
        method: "POST",
        body: JSON.stringify({ duration_s: durationS }),
      },
    );
  }

  async pairBluetooth(mac: string): Promise<BluetoothPairResult> {
    return this.request<BluetoothPairResult>(
      "/api/v1/ground-station/bluetooth/pair",
      {
        method: "POST",
        body: JSON.stringify({ mac }),
      },
    );
  }

  async forgetBluetooth(mac: string): Promise<BluetoothForgetResult> {
    const encoded = encodeURIComponent(mac);
    return this.request<BluetoothForgetResult>(
      `/api/v1/ground-station/bluetooth/${encoded}`,
      { method: "DELETE" },
    );
  }

  async getPairedBluetooth(): Promise<BluetoothPairedList> {
    return this.request<BluetoothPairedList>(
      "/api/v1/ground-station/bluetooth/paired",
    );
  }

  async listGamepads(): Promise<GamepadList> {
    return this.request<GamepadList>("/api/v1/ground-station/gamepads");
  }

  async setPrimaryGamepad(deviceId: string | null): Promise<GamepadList> {
    return this.request<GamepadList>(
      "/api/v1/ground-station/gamepads/primary",
      {
        method: "PUT",
        body: JSON.stringify({ primary_id: deviceId }),
      },
    );
  }

  async getPicState(): Promise<PicState> {
    return this.request<PicState>("/api/v1/ground-station/pic");
  }

  async claimPic(
    clientId: string,
    confirmToken?: string,
    force?: boolean,
  ): Promise<PicClaimResult> {
    const body: Record<string, unknown> = { client_id: clientId };
    if (confirmToken) body.confirm_token = confirmToken;
    if (force) body.force = true;
    return this.request<PicClaimResult>("/api/v1/ground-station/pic/claim", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async releasePic(clientId: string): Promise<PicReleaseResult> {
    return this.request<PicReleaseResult>(
      "/api/v1/ground-station/pic/release",
      {
        method: "POST",
        body: JSON.stringify({ client_id: clientId }),
      },
    );
  }

  async createPicConfirmToken(clientId: string): Promise<PicConfirmTokenResult> {
    return this.request<PicConfirmTokenResult>(
      "/api/v1/ground-station/pic/confirm-token",
      {
        method: "POST",
        body: JSON.stringify({ client_id: clientId }),
      },
    );
  }

  /**
   * Subscribe to PIC events via WebSocket.
   * Returns an unsubscribe function that closes the socket.
   * Reconnects automatically with exponential backoff on close.
   */
  subscribePicEvents(onEvent: (e: PicEvent) => void): () => void {
    if (typeof window === "undefined") {
      return () => {};
    }
    const httpBase = this.baseUrl;
    const wsBase = httpBase.replace(/^http/, "ws");
    const path = "/api/v1/ground-station/pic/events";
    const urlObj = new URL(wsBase + path);
    if (this.apiKey) {
      urlObj.searchParams.set("api_key", this.apiKey);
    }
    const url = urlObj.toString();

    let closed = false;
    let ws: WebSocket | null = null;
    let retryDelay = 500;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        retryDelay = 500;
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as PicEvent;
          onEvent(data);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onerror = () => {
        // onclose handles reconnection
      };
      ws.onclose = () => {
        ws = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closed) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        retryDelay = Math.min(retryDelay * 2, 10000);
        connect();
      }, retryDelay);
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    };
  }
}

/**
 * Build a GroundStationApi client from the current agent connection, if any.
 * Reuses the existing agentUrl + apiKey so that the Hardware tab does not
 * need a separate connection lifecycle in Phase 0.
 */
export function groundStationApiFromAgent(
  agentUrl: string | null,
  apiKey: string | null,
): GroundStationApi | null {
  if (!agentUrl) return null;
  return new GroundStationApi(agentUrl, apiKey);
}
