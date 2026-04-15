/**
 * @module GroundStationApi
 * @description Typed REST client for the ADOS Ground Agent HTTP surface.
 * Phase 0: status, wfb GET/PUT.
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
      throw new Error(`Ground station API ${res.status}: ${text}`);
    }
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
