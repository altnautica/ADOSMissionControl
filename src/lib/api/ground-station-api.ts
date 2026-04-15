/**
 * @module GroundStationApi
 * @description Typed REST client for the ADOS Ground Agent HTTP surface.
 * Phase 0: status, wfb GET/PUT.
 * Phase 1 (Wave D): network, pair, UI, factory-reset.
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
