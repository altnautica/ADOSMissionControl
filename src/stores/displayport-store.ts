/**
 * @module displayport-store
 * @description Reconstructs the OSD a flight controller pushes over MSP
 * DisplayPort (182) into a character grid the GCS can render live.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { DroneProtocol } from "@/lib/protocol/types";
import { DisplayPortScreen } from "@/lib/osd/displayport-screen";
import { DP_RESOLUTIONS } from "@/lib/protocol/msp/decoders/config/displayport";

interface DisplayPortState {
  lines: string[];
  cols: number;
  rows: number;
  resolutionLabel: string;
  lastFrameAt: number | null;
  attached: boolean;
  attach: (protocol: DroneProtocol) => void;
  detach: () => void;
}

// Non-reactive working state (single store instance ⇒ safe at module scope).
let screen = new DisplayPortScreen();
let unsub: (() => void) | null = null;
let resolutionIdx = 0;

export const useDisplayPortStore = create<DisplayPortState>((set, get) => ({
  lines: [],
  cols: screen.cols,
  rows: screen.rows,
  resolutionLabel: DP_RESOLUTIONS[0].label,
  lastFrameAt: null,
  attached: false,

  attach(protocol) {
    get().detach();
    if (!protocol.onDisplayPort) {
      set({ attached: false });
      return;
    }
    screen = new DisplayPortScreen();
    resolutionIdx = 0;
    set({ lines: [], cols: screen.cols, rows: screen.rows, lastFrameAt: null, attached: true });
    unsub = protocol.onDisplayPort((op) => {
      const drew = screen.applyOp(op);
      if (op.kind === "options") resolutionIdx = op.resolution;
      // A released display shows nothing and is no longer a live frame.
      if (op.kind === "release") {
        set({ lines: screen.toLines(), lastFrameAt: null });
        return;
      }
      // Commit a full frame on DRAW_SCREEN (or an OPTIONS resize).
      if (drew || op.kind === "options") {
        set({
          lines: screen.toLines(),
          cols: screen.cols,
          rows: screen.rows,
          resolutionLabel: DP_RESOLUTIONS[resolutionIdx]?.label ?? `${screen.cols}x${screen.rows}`,
          lastFrameAt: Date.now(),
        });
      }
    });
  },

  detach() {
    if (unsub) {
      unsub();
      unsub = null;
    }
    set({ attached: false });
  },
}));
