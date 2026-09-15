/**
 * @module stores/ui-store
 * @description Shell-level UI state.
 *
 * `immersiveMode` used to be a bare boolean that only hid chrome. An operator
 * flying from the cockpit with both hands on the sticks generates no pointer
 * or keyboard input, so the OS screensaver or display sleep blacks out the
 * piloting surface on its default idle timer — and the browser chrome stayed
 * on screen, which made "immersive" a misnomer. Entering now also requests
 * fullscreen and holds a screen wake lock; leaving releases both.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { ViewId, PanelState } from "@/lib/types";

/**
 * The held screen wake lock, or null.
 *
 * Module-local rather than store state: it is an opaque platform handle that
 * no component renders, and putting it in the store would make every
 * subscriber re-render when it is acquired. The visibility listener below
 * needs it, and that is the whole audience.
 */
let wakeLock: WakeLockSentinel | null = null;
let visibilityListener: (() => void) | null = null;

async function acquireWakeLock(): Promise<void> {
  // Feature detection through `in`, not a truthiness check: `lib.dom` types
  // `navigator.wakeLock` as non-optional, so the property read would compile
  // on a browser that does not implement it and throw at runtime.
  if (!("wakeLock" in navigator)) return;
  if (wakeLock !== null && !wakeLock.released) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    // Denied (insecure context, backgrounded document, platform policy).
    // Nothing to report: the cockpit works, the display may sleep.
    wakeLock = null;
  }
}

/**
 * Re-acquire on return to visibility. The spec releases a screen wake lock
 * automatically whenever the document becomes hidden, so without this an
 * operator who alt-tabs away once loses the lock for the rest of the flight
 * while the UI still claims to be in immersive mode.
 */
function armWakeLockReacquire(): void {
  if (typeof document === "undefined" || visibilityListener) return;
  visibilityListener = () => {
    if (document.visibilityState !== "visible") return;
    if (!useUiStore.getState().immersiveMode) return;
    void acquireWakeLock();
  };
  document.addEventListener("visibilitychange", visibilityListener);
}

function disarmWakeLockReacquire(): void {
  if (typeof document === "undefined" || !visibilityListener) return;
  document.removeEventListener("visibilitychange", visibilityListener);
  visibilityListener = null;
}

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
  // The flag flips SYNCHRONOUSLY so the shell's chrome drops on the same
  // commit as the click; the platform requests are fire-and-forget after it.
  // Both are guarded by feature detection and neither can block the mode.
  enterImmersiveMode: () => {
    set({ immersiveMode: true });
    if (typeof document !== "undefined" && document.documentElement.requestFullscreen) {
      // Always reached from a user gesture (the cockpit's immersive button or
      // its keybinding), so the gesture requirement is satisfied; a rejection
      // is still ignored rather than surfaced, because immersive mode without
      // fullscreen is degraded, not broken.
      void document.documentElement.requestFullscreen().catch(() => {});
    }
    armWakeLockReacquire();
    void acquireWakeLock();
  },
  exitImmersiveMode: () => {
    set({ immersiveMode: false });
    disarmWakeLockReacquire();
    if (wakeLock !== null) {
      const held = wakeLock;
      wakeLock = null;
      void held.release().catch(() => {});
    }
    if (
      typeof document !== "undefined" &&
      document.fullscreenElement &&
      document.exitFullscreen
    ) {
      void document.exitFullscreen().catch(() => {});
    }
  },
  setPendingParamSearch: (pendingParamSearch) => set({ pendingParamSearch }),
  setPendingDetailTab: (pendingDetailTab) => set({ pendingDetailTab }),
  setPendingAgentPanel: (pendingAgentPanel) => set({ pendingAgentPanel }),
  setPendingPluginId: (pendingPluginId) => set({ pendingPluginId }),
  setRightRailPanel: (rightRailPanel) => set({ rightRailPanel }),
}));
