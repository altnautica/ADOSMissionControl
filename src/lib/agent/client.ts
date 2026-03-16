/**
 * @module AgentClient
 * @description REST API client for communicating with the ADOS Drone Agent.
 * @license GPL-3.0-only
 */

import type {
  AgentStatus,
  TelemetrySnapshot,
  ServiceInfo,
  SystemResources,
  LogEntry,
  CommandResult,
  PeripheralInfo,
  ScriptInfo,
  ScriptRunResult,
  SuiteInfo,
  DroneNetEnrollment,
  NetworkPeer,
  PairingInfo,
  ClaimResponse,
} from "./types";

export class AgentClient {
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
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Agent API ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async getStatus(): Promise<AgentStatus> {
    return this.request<AgentStatus>("/api/status");
  }

  async getTelemetry(): Promise<TelemetrySnapshot> {
    return this.request<TelemetrySnapshot>("/api/telemetry");
  }

  async getServices(): Promise<ServiceInfo[]> {
    return this.request<ServiceInfo[]>("/api/services");
  }

  async getSystemResources(): Promise<SystemResources> {
    return this.request<SystemResources>("/api/system");
  }

  async getLogs(params?: { level?: string; limit?: number }): Promise<LogEntry[]> {
    const qs = new URLSearchParams();
    if (params?.level) qs.set("level", params.level);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return this.request<LogEntry[]>(`/api/logs${query ? `?${query}` : ""}`);
  }

  async getParams(): Promise<Record<string, number>> {
    return this.request<Record<string, number>>("/api/params");
  }

  async sendCommand(cmd: string, args?: unknown[]): Promise<CommandResult> {
    return this.request<CommandResult>("/api/command", {
      method: "POST",
      body: JSON.stringify({ command: cmd, args: args ?? [] }),
    });
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/config");
  }

  async restartService(name: string): Promise<CommandResult> {
    return this.request<CommandResult>(`/api/services/${encodeURIComponent(name)}/restart`, {
      method: "POST",
    });
  }

  // ── Peripherals ─────────────────────────────────────────

  async getPeripherals(): Promise<PeripheralInfo[]> {
    return this.request<PeripheralInfo[]>("/api/peripherals");
  }

  async scanPeripherals(): Promise<PeripheralInfo[]> {
    return this.request<PeripheralInfo[]>("/api/peripherals/scan", { method: "POST" });
  }

  // ── Scripts ─────────────────────────────────────────────

  async getScripts(): Promise<ScriptInfo[]> {
    return this.request<ScriptInfo[]>("/api/scripts");
  }

  async saveScript(name: string, content: string, suite?: string): Promise<ScriptInfo> {
    return this.request<ScriptInfo>("/api/scripts", {
      method: "POST",
      body: JSON.stringify({ name, content, suite }),
    });
  }

  async deleteScript(id: string): Promise<CommandResult> {
    return this.request<CommandResult>(`/api/scripts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async runScript(id: string): Promise<ScriptRunResult> {
    return this.request<ScriptRunResult>(`/api/scripts/${encodeURIComponent(id)}/run`, {
      method: "POST",
    });
  }

  // ── Suites ──────────────────────────────────────────────

  async getSuites(): Promise<SuiteInfo[]> {
    return this.request<SuiteInfo[]>("/api/suites");
  }

  async installSuite(id: string): Promise<CommandResult> {
    return this.request<CommandResult>(`/api/suites/${encodeURIComponent(id)}/install`, {
      method: "POST",
    });
  }

  async uninstallSuite(id: string): Promise<CommandResult> {
    return this.request<CommandResult>(`/api/suites/${encodeURIComponent(id)}/uninstall`, {
      method: "POST",
    });
  }

  async activateSuite(id: string): Promise<CommandResult> {
    return this.request<CommandResult>(`/api/suites/${encodeURIComponent(id)}/activate`, {
      method: "POST",
    });
  }

  // ── Fleet ───────────────────────────────────────────────

  async getEnrollment(): Promise<DroneNetEnrollment> {
    return this.request<DroneNetEnrollment>("/api/fleet/enrollment");
  }

  async getPeers(): Promise<NetworkPeer[]> {
    return this.request<NetworkPeer[]>("/api/fleet/peers");
  }

  // ── Pairing ──────────────────────────────────────────────

  async getPairingInfo(): Promise<PairingInfo> {
    return this.request<PairingInfo>("/api/pairing/info");
  }

  async claimLocally(userId: string): Promise<ClaimResponse> {
    return this.request<ClaimResponse>("/api/pairing/claim", {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async unpairAgent(): Promise<CommandResult> {
    return this.request<CommandResult>("/api/pairing/unpair", {
      method: "POST",
    });
  }
}
