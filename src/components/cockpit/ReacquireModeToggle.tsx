"use client";

/**
 * @module cockpit/ReacquireModeToggle
 * @description STRICT | SMART segmented control for the follow-me re-acquire
 * mode. Shared by the right rail and the follow skill popover; both read the
 * same pending state, so a change made in one shows pending in the other.
 * A pending option carries a 1 px dashed outline until the echo arrives.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { ReacquireMode } from "@/lib/hud/nav-types";
import { specString } from "@/lib/cockpit/spec-strings";
import { cn } from "@/lib/utils";
import { useReacquireMode } from "@/hooks/use-reacquire-mode";

const MODES: readonly ReacquireMode[] = ["strict", "smart"];

interface ReacquireModeToggleProps {
  droneId: string;
  /** `follow.state.reacquireMode`, the echoed value. */
  echoed: ReacquireMode | null;
  /** Stack the options vertically (the rail). */
  vertical?: boolean;
  className?: string;
}

export function ReacquireModeToggle({
  droneId,
  echoed,
  vertical = false,
  className,
}: ReacquireModeToggleProps) {
  const t = useTranslations("hud.rail");
  const { mode, pending, select } = useReacquireMode(droneId, echoed);
  return (
    <div
      role="group"
      aria-label={specString("target.reacquire_mode")}
      className={cn("reacq", vertical && "reacq-v", className)}
      data-testid="reacquire-toggle"
    >
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          data-pending={pending === m ? "true" : undefined}
          title={pending === m ? t("pending") : undefined}
          onClick={() => select(m)}
        >
          {t(m)}
        </button>
      ))}
    </div>
  );
}
