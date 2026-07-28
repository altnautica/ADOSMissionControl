"use client";

/**
 * @module command/swarm-view/use-broadcast-arm
 * @description The second gate on a command whose target is literally the whole
 * fleet.
 *
 * The typed-phrase confirm already asks "are you sure about this action". It
 * cannot ask the other question — "did you mean all twenty-four?" — because by
 * the time the dialog opens the target set is already decided. So a fleet-wide
 * control is inert until BROADCAST is armed, and the arm expires on its own
 * after five seconds.
 *
 * The self-revert is the point. A sticky mode is a mode an operator forgets
 * they are in, and the whole fleet is the worst possible thing to be
 * accidentally pointed at; a gate that decays needs no discipline to close.
 * Arming again restarts the window rather than extending it, so the operator
 * can never accumulate a longer one by mashing the button.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** How long an armed broadcast survives without being used. */
export const BROADCAST_ARM_MS = 5000;

export interface BroadcastArm {
  armed: boolean;
  /** Epoch ms the arm lapses at, for the countdown the button renders. */
  armedUntil: number | null;
  arm: () => void;
  disarm: () => void;
}

export function useBroadcastArm(windowMs: number = BROADCAST_ARM_MS): BroadcastArm {
  const [armedUntil, setArmedUntil] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const disarm = useCallback(() => {
    clear();
    setArmedUntil(null);
  }, [clear]);

  const arm = useCallback(() => {
    clear();
    setArmedUntil(Date.now() + windowMs);
    timer.current = setTimeout(() => {
      timer.current = null;
      setArmedUntil(null);
    }, windowMs);
  }, [clear, windowMs]);

  // An armed broadcast must not outlive the surface that armed it: unmounting
  // the action bar is as much a "never mind" as pressing the button again.
  useEffect(() => clear, [clear]);

  return { armed: armedUntil !== null, armedUntil, arm, disarm };
}
