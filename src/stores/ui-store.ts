import { create } from "zustand";
import type { ViewId, PanelState } from "@/lib/types";

interface UiStoreState {
  activeView: ViewId;
  panels: PanelState;
  sidebarOpen: boolean;
  modalOpen: string | null;
  immersiveMode: boolean;
  /** Dashboard no-selection body: "grid" = node tiles with live video +
   * telemetry, "overview" = fleet map + status cards, "nodes" = the
   * fleet-operations board (one live row per node with inline controls),
   * "swarm" = the fleet-wide swarm board (one row per fleet slot, driven by
   * the swarm-bus beacons rather than per-node polling).
   * Ephemeral; defaults to grid each load. */
  dashboardView: "grid" | "overview" | "nodes" | "swarm";
  /** Pending param search from Cmd+K — consumed by ParametersPanel to set initial filter. */
  pendingParamSearch: string | null;
  /** Pending detail tab switch from Cmd+K — consumed by DroneDetailPanel. */
  pendingDetailTab: string | null;
  /** Pending Agent sub-page from a deep-link / persisted-tab remap of a
   * now-nested id (settings / vision / logs / ...) — consumed by AgentTab. */
  pendingAgentPanel: string | null;
  /** Plugin id to reveal when the operator jumps to the Plugins panel (e.g.
   * from a plugin-owned camera's "Managed by" link) — consumed by the drone
   * plugins list, which scrolls the matching card into view. */
  pendingPluginId: string | null;
  /** Which global right-rail panel is expanded (MCP activity / flight logs),
   * or null when the rail is collapsed. Ephemeral; survives route changes so a
   * watcher can keep the MCP panel open while the MCP drives other surfaces. */
  rightRailPanel: "mcp" | "logs" | null;

  setActiveView: (view: ViewId) => void;
  setDashboardView: (view: "grid" | "overview" | "nodes" | "swarm") => void;
  togglePanel: (panel: keyof PanelState) => void;
  setPanel: (panel: keyof PanelState, open: boolean) => void;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  openModal: (id: string) => void;
  closeModal: () => void;
  enterImmersiveMode: () => void;
  exitImmersiveMode: () => void;
  setPendingParamSearch: (query: string | null) => void;
  setPendingDetailTab: (tab: string | null) => void;
  setPendingAgentPanel: (panel: string | null) => void;
  setPendingPluginId: (pluginId: string | null) => void;
  setRightRailPanel: (panel: "mcp" | "logs" | null) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  activeView: "dashboard",
  panels: { telemetry: true, alerts: true, chat: false },
  sidebarOpen: true,
  modalOpen: null,
  immersiveMode: false,
  dashboardView: "grid",
  pendingParamSearch: null,
  pendingDetailTab: null,
  pendingAgentPanel: null,
  pendingPluginId: null,
  rightRailPanel: null,

  setActiveView: (activeView) => set({ activeView }),
  setDashboardView: (dashboardView) => set({ dashboardView }),

  togglePanel: (panel) =>
    set((state) => ({
      panels: { ...state.panels, [panel]: !state.panels[panel] },
    })),

  setPanel: (panel, open) =>
    set((state) => ({
      panels: { ...state.panels, [panel]: open },
    })),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  openModal: (modalOpen) => set({ modalOpen }),
  closeModal: () => set({ modalOpen: null }),
  enterImmersiveMode: () => set({ immersiveMode: true }),
  exitImmersiveMode: () => set({ immersiveMode: false }),
  setPendingParamSearch: (pendingParamSearch) => set({ pendingParamSearch }),
  setPendingDetailTab: (pendingDetailTab) => set({ pendingDetailTab }),
  setPendingAgentPanel: (pendingAgentPanel) => set({ pendingAgentPanel }),
  setPendingPluginId: (pendingPluginId) => set({ pendingPluginId }),
  setRightRailPanel: (rightRailPanel) => set({ rightRailPanel }),
}));
