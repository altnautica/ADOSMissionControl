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

  async getServices(agentUptimeHint?: number): Promise<ServiceInfo[]> {
    const svcRes = await this.request<{ services: Array<Record<string, unknown>> }>("/api/services");
    const list = Array.isArray(svcRes) ? svcRes : (svcRes.services ?? []);

    // Compute per-service uptime from monotonic last_transition timestamps.
    // Use agent uptime hint (from store) to estimate current monotonic time.
    const agentUptime = agentUptimeHint ?? 0;
    const transitions = list
      .map((s) => (typeof s.last_transition === "number" ? s.last_transition : 0))
      .filter((t) => t > 0);
    const earliestStart = transitions.length > 0 ? Math.min(...transitions) : 0;
    const monotonicNow = earliestStart > 0 ? earliestStart + agentUptime : 0;

    return list.map((s) => {
      const lastTransition = typeof s.last_transition === "number" ? s.last_transition : 0;
      const uptimeSeconds = monotonicNow > 0 && lastTransition > 0
        ? Math.max(0, monotonicNow - lastTransition)
        : (typeof s.uptime_seconds === "number" ? s.uptime_seconds : 0);

      return {
        name: String(s.name ?? "unknown"),
        status: (s.status ?? s.state ?? "stopped") as ServiceInfo["status"],
        pid: typeof s.pid === "number" ? s.pid : null,
        cpu_percent: typeof s.cpu_percent === "number" ? s.cpu_percent : (typeof s.cpuPercent === "number" ? s.cpuPercent : 0),
        memory_mb: typeof s.memory_mb === "number" ? s.memory_mb : (typeof s.memoryMb === "number" ? s.memoryMb : 0),
        uptime_seconds: uptimeSeconds,
      };
    });
  }

  async getSystemResources(): Promise<SystemResources> {
    const res = await this.request<Record<string, unknown>>("/api/system");
    // Agent returns temperatures: { cpu_thermal: 45.2 } — map to flat temperature field
    let temperature: number | null = null;
    if (res.temperature != null) {
      temperature = Number(res.temperature);
    } else if (res.temperatures && typeof res.temperatures === "object") {
      const temps = res.temperatures as Record<string, number>;
      temperature = temps.cpu_thermal ?? Object.values(temps)[0] ?? null;
    }
    return {
      cpu_percent: Number(res.cpu_percent ?? 0),
      memory_percent: Number(res.memory_percent ?? 0),
      memory_used_mb: Number(res.memory_used_mb ?? 0),
      memory_total_mb: Number(res.memory_total_mb ?? 0),
      disk_percent: Number(res.disk_percent ?? 0),
      disk_used_gb: Number(res.disk_used_gb ?? 0),
      disk_total_gb: Number(res.disk_total_gb ?? 0),
      temperature,
    };
  }

  async getLogs(params?: { level?: string; limit?: number }): Promise<LogEntry[]> {
    const qs = new URLSearchParams();
    if (params?.level) qs.set("level", params.level);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    const res = await this.request<LogEntry[] | { entries: LogEntry[] }>(`/api/logs${query ? `?${query}` : ""}`);
    return Array.isArray(res) ? res : (res.entries ?? []);
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
    const res = await this.request<ScriptInfo[] | { scripts: ScriptInfo[] }>("/api/scripts");
    return Array.isArray(res) ? res : (res.scripts ?? []);
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
