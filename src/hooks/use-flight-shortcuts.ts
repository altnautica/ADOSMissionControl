/**
 * @module use-flight-shortcuts
 * @description Keyboard shortcuts for flight actions (Shift+key).
 * ARM/DISARM, RTH, Land, Takeoff, Pause/Hold/Resume, Abort.
 * Kill has no shortcut (too dangerous, requires 2-step click).
 *
 * Every key hands off to a caller-supplied dispatch, which is the skill
 * pipeline: a hotkey and a panel press must produce the same confirm, the same
 * arm gate and the same refusal feedback. The Pause key used to command the
 * vehicle itself and, with no protocol, write LOITER into the local drone store
 * and toast "Mission paused" — a mode change and a success message for a
 * command that was never transmitted.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useDroneStore } from "@/stores/drone-store";

interface UseFlightShortcutsParams {
  enabled: boolean;
  onArmConfirm: () => void;
  onDisarmConfirm: () => void;
  onRthConfirm: () => void;
  onTakeoffConfirm: () => void;
  onLandConfirm: () => void;
  onAbortConfirm: () => void;
  /** Mission-aware pause/resume/hold, chosen by the caller from live state. */
  onPauseResume: () => void;
}

export function useFlightShortcuts({
  enabled,
  onArmConfirm,
  onDisarmConfirm,
  onRthConfirm,
  onTakeoffConfirm,
  onLandConfirm,
  onAbortConfirm,
  onPauseResume,
}: UseFlightShortcutsParams) {
  useEffect(() => {
    if (!enabled) return;

    function handleKey(e: KeyboardEvent) {
      // Require Shift held, reject if Ctrl/Meta/Alt also held
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

      // Don't capture when typing in inputs
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const droneState = useDroneStore.getState();

      switch (e.key) {
        case "A": {
          // ARM / DISARM toggle: open the same confirmation flow as the UI.
          // With no live heartbeat the toggle has no side to pick.
          e.preventDefault();
          if (droneState.armState === "armed") onDisarmConfirm();
          else if (droneState.armState === "disarmed") onArmConfirm();
          break;
        }
        case "R": {
          // Return to Home (opens confirmation dialog)
          e.preventDefault();
          onRthConfirm();
          break;
        }
        case "L": {
          // Land: open confirmation flow.
          e.preventDefault();
          onLandConfirm();
          break;
        }
        case "T": {
          // Takeoff: the caller validates the altitude and opens the confirm.
          e.preventDefault();
          onTakeoffConfirm();
          break;
        }
        case "P": {
          // Pause / Hold / Resume. The caller picks which of the three from the
          // same mode/mission state the panel button uses, and dispatches it
          // through the skill pipeline — which is also what reports whether the
          // vehicle accepted it. Nothing is claimed here.
          e.preventDefault();
          onPauseResume();
          break;
        }
        case "X": {
          // Abort (opens confirmation dialog)
          e.preventDefault();
          onAbortConfirm();
          break;
        }
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    enabled,
    onArmConfirm,
    onDisarmConfirm,
    onRthConfirm,
    onTakeoffConfirm,
    onLandConfirm,
    onAbortConfirm,
    onPauseResume,
  ]);
}
