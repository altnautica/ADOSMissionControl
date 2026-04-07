/**
 * @module AgentScriptsStore
 * @description Zustand store for ADOS Drone Agent scripts, suites, and fleet network.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  ScriptInfo,
  ScriptRunResult,
  SuiteInfo,
  DroneNetEnrollment,
  NetworkPeer,
} from "@/lib/agent/types";
import { getBuiltInSamples } from "@/lib/agent/sample-scripts";
import { useAgentConnectionStore } from "./agent-connection-store";

/**
 * Merge built-in samples into a script list. Samples are identified by
 * an `id` prefix of `sample-`. If the agent already returned samples
 * (future: seeded by agent install), we leave those alone and only
 * backfill the missing ones.
 */
function mergeSamples(fromAgent: ScriptInfo[]): ScriptInfo[] {
  const samples = getBuiltInSamples();
  const agentIds = new Set(fromAgent.map((s) => s.id));
  const missing = samples.filter((s) => !agentIds.has(s.id));
  return [...fromAgent, ...missing];
}

interface AgentScriptsState {
  scripts: ScriptInfo[];
  scriptOutput: ScriptRunResult | null;
  runningScript: string | null;
  suites: SuiteInfo[];
  enrollment: DroneNetEnrollment | null;
  peers: NetworkPeer[];
}

interface AgentScriptsActions {
  fetchScripts: () => Promise<void>;
  saveScript: (name: string, content: string, suite?: string) => Promise<ScriptInfo | null>;
  deleteScript: (id: string) => Promise<void>;
  runScript: (id: string) => Promise<void>;
  fetchSuites: () => Promise<void>;
  installSuite: (id: string) => Promise<void>;
  uninstallSuite: (id: string) => Promise<void>;
  activateSuite: (id: string) => Promise<void>;
  fetchEnrollment: () => Promise<void>;
  fetchPeers: () => Promise<void>;
  clear: () => void;
}

export type AgentScriptsStore = AgentScriptsState & AgentScriptsActions;

export const useAgentScriptsStore = create<AgentScriptsStore>((set, get) => ({
  // Seed built-in samples up front so the Scripts library is never empty,
  // even before the agent has responded with a script list. The samples
  // give new users and demo-mode evaluators an immediate starting point.
  scripts: getBuiltInSamples(),
  scriptOutput: null,
  runningScript: null,
  suites: [],
  enrollment: null,
  peers: [],

  // ── Scripts ─────────────────────────────────────────────

  async fetchScripts() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_scripts");
      return;
    }
    if (!client) return;
    try {
      const scripts = await client.getScripts();
      set({ scripts: mergeSamples(scripts) });
    } catch { /* silent */ }
  },

  async saveScript(name: string, content: string, suite?: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("save_script", { name, content, suite });
      return null;
    }
    if (!client) return null;
    try {
      const script = await client.saveScript(name, content, suite);
      await get().fetchScripts();
      return script;
    } catch {
      return null;
    }
  },

  async deleteScript(id: string) {
    // Built-in samples are read-only — refuse delete.
    if (id.startsWith("sample-")) return;
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("delete_script", { id });
      return;
    }
    if (!client) return;
    try {
      await client.deleteScript(id);
      await get().fetchScripts();
    } catch { /* silent */ }
  },

  async runScript(id: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      set({ runningScript: id, scriptOutput: null });
      useAgentConnectionStore.getState().sendCloudCommand("run_script", { id });
      return;
    }
    if (!client) return;
    set({ runningScript: id, scriptOutput: null });
    try {
      const result = await client.runScript(id);
      set({ scriptOutput: result, runningScript: null });
    } catch {
      set({
        scriptOutput: { stdout: "", stderr: "Failed to execute script", exitCode: 1, durationMs: 0 },
        runningScript: null,
      });
    }
  },

  // ── Suites ──────────────────────────────────────────────

  async fetchSuites() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_suites");
      return;
    }
    if (!client) return;
    try {
      const suites = await client.getSuites();
      set({ suites });
    } catch { /* silent */ }
  },

  async installSuite(id: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("install_suite", { id });
      return;
    }
    if (!client) return;
    try {
      await client.installSuite(id);
      await get().fetchSuites();
    } catch { /* silent */ }
  },

  async uninstallSuite(id: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("uninstall_suite", { id });
      return;
    }
    if (!client) return;
    try {
      await client.uninstallSuite(id);
      await get().fetchSuites();
    } catch { /* silent */ }
  },

  async activateSuite(id: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("activate_suite", { id });
      return;
    }
    if (!client) return;
    try {
      await client.activateSuite(id);
      await get().fetchSuites();
    } catch { /* silent */ }
  },

  // ── Fleet ───────────────────────────────────────────────

  async fetchEnrollment() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_enrollment");
      return;
    }
    if (!client) return;
    try {
      const enrollment = await client.getEnrollment();
      set({ enrollment });
    } catch { /* silent */ }
  },

  async fetchPeers() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_peers");
      return;
    }
    if (!client) return;
    try {
      const peers = await client.getPeers();
      set({ peers });
    } catch { /* silent */ }
  },

  clear() {
    set({
      scripts: [],
      scriptOutput: null,
      runningScript: null,
      suites: [],
      enrollment: null,
      peers: [],
    });
  },
}));
