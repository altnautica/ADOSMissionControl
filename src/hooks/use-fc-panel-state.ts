"use client";

/**
 * Composite hook that combines the common FC panel boilerplate:
 * - usePanelParams (param loading, dirty tracking, save/flash)
 * - useUnsavedGuard (beforeunload warning when dirty)
 * - useDroneManager (getSelectedProtocol accessor)
 * - usePanelScroll (optional scroll position persistence)
 *
 * Does NOT include useArmedLock — that renders a UI overlay and
 * is wired differently per panel.
 *
 * @license GPL-3.0-only
 */

import { usePanelParams } from "./use-panel-params";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { usePanelScroll } from "./use-panel-scroll";
import { useDroneManager } from "@/stores/drone-manager";
import type { PanelParamOptions, PanelParamState, PanelParamActions } from "./use-panel-params-types";
import type { DroneProtocol } from "@/lib/protocol/types";

export interface FcPanelStateOptions extends PanelParamOptions {
  /** Enable scroll position save/restore for this panel (default: false) */
  scroll?: boolean;
}

export interface FcPanelStateReturn extends PanelParamState, PanelParamActions {
  /** Accessor for the currently selected drone's protocol instance */
  getProtocol: () => DroneProtocol | null;
  /** Ref to attach to the scrollable container (only meaningful when scroll: true) */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function useFcPanelState(options: FcPanelStateOptions): FcPanelStateReturn {
  const { scroll = false, ...panelParamOptions } = options;

  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);

  const panelState = usePanelParams(panelParamOptions);

  useUnsavedGuard(panelState.dirtyParams.size > 0);

  const scrollRef = usePanelScroll(scroll ? panelParamOptions.panelId : "__noop__");

  return {
    ...panelState,
    getProtocol,
    scrollRef,
  };
}
