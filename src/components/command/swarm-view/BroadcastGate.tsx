"use client";

/**
 * @module command/swarm-view/BroadcastGate
 * @description The arm button for a command aimed at the entire fleet.
 *
 * It answers a question the typed-phrase confirm structurally cannot. By the
 * time that dialog opens the target set is already chosen; it can ask "are you
 * sure about this action", never "did you mean all twenty-four of them". So
 * when the selection IS the whole fleet, the action controls stay inert until
 * this is pressed.
 *
 * The bar drains in real time because a gate that closes on its own is only
 * trustworthy if the operator can watch it closing. Under reduced motion the
 * bar is not rendered at all — the gate still expires on the same schedule, it
 * simply stops advertising it, which is the honest degradation: a static full
 * bar would say the opposite of the truth.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export interface BroadcastGateProps {
  armed: boolean;
  /** How long the arm lasts, so the bar drains over exactly that window. */
  windowMs: number;
  /** How many slots "all" currently means — stated, never implied. */
  targetCount: number;
  onArm: () => void;
  onDisarm: () => void;
}

export function BroadcastGate({
  armed,
  windowMs,
  targetCount,
  onArm,
  onDisarm,
}: BroadcastGateProps) {
  const t = useTranslations("swarmView.broadcast");
  const reducedMotion = usePrefersReducedMotion();

  return (
    <button
      type="button"
      onClick={armed ? onDisarm : onArm}
      aria-pressed={armed}
      title={armed ? t("disarmHint") : t("armHint", { count: targetCount })}
      className={cn(
        "relative flex items-center gap-1.5 overflow-hidden rounded border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
        armed
          ? "border-status-error bg-status-error/10 text-status-error"
          : "border-border-default bg-bg-secondary text-text-secondary hover:text-text-primary",
      )}
    >
      <Radio
        size={12}
        className={armed && !reducedMotion ? "animate-pulse" : undefined}
      />
      <span className="font-medium">
        {armed ? t("armed", { count: targetCount }) : t("arm")}
      </span>
      {armed && !reducedMotion && <DrainBar durationMs={windowMs} />}
    </button>
  );
}

/**
 * Mounts full and shrinks to nothing over the arm window. It exists only while
 * armed, so re-arming remounts it and the drain restarts from full without any
 * reset bookkeeping. Two frames before the transition starts: one commit for
 * the full-width paint, one for the browser to notice the property changed.
 */
function DrainBar({ durationMs }: { durationMs: number }) {
  const [drained, setDrained] = useState(false);

  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDrained(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-status-error"
      style={{
        transform: drained ? "scaleX(0)" : "scaleX(1)",
        transition: `transform ${drained ? durationMs : 0}ms linear`,
      }}
    />
  );
}
