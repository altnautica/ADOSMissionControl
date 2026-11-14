"use client";

/**
 * @module cockpit/FollowSettingToggle
 * @description The follow-me quick settings on the rail: STRICT | SMART
 * re-acquire, FOLLOW | HOLD when unsure (segmented), and the predictive
 * search switch. Each writes through the plugin config writer and shows its
 * new value with a 1 px dashed outline until `follow.state` echoes it. The
 * predictive search switch shows only in smart re-acquire, as the follow-me
 * manifest declares it (`visible_if reacquire_mode == smart`), the only mode
 * it acts in.
 *
 * @license GPL-3.0-only
 */

import { specString } from "@/lib/cockpit/spec-strings";
import type { FollowRailSetting } from "@/lib/cockpit/follow-rail-layout";
import { cn } from "@/lib/utils";
import { useFollowSetting, type FollowSettingKey } from "@/hooks/use-follow-setting";
import { useFollowingMode } from "@/hooks/use-following-mode";

/** The quick settings shown for a drone, in order: none without follow-me,
 *  and the predictive search switch only while re-acquire reads smart
 *  (a pending STRICT hides it at once). */
export function useFollowQuickSettings(droneId: string): FollowRailSetting[] {
  const { follow, installed } = useFollowingMode(droneId);
  const { value: mode } = useFollowSetting<string>(droneId, "reacquire_mode", follow?.reacquireMode ?? null);
  if (!installed) return [];
  return mode === "strict" ? ["reacquire_mode", "uncertain_mode"] : ["reacquire_mode", "uncertain_mode", "predictive_search"];
}

/** The quick settings as one group of controls (inline on the rail, or in its More sheet). */
export function FollowQuickSettings({ droneId, className }: { droneId: string; className?: string }) {
  const { follow } = useFollowingMode(droneId);
  const settings = useFollowQuickSettings(droneId);
  return (
    <>
      {settings.map((s) =>
        s === "predictive_search" ? (
          <PredictiveSearchToggle key={s} droneId={droneId} echoed={follow?.predictiveSearch ?? null} className={className} />
        ) : (
          <FollowSettingToggle
            key={s}
            droneId={droneId}
            setting={s}
            echoed={(s === "reacquire_mode" ? follow?.reacquireMode : follow?.uncertainMode) ?? null}
            className={className}
          />
        ),
      )}
    </>
  );
}

/** The two-value settings, their spec label and their options' words. */
const SEGMENTED = {
  reacquire_mode: {
    label: "target.reacquire_mode",
    options: [
      ["strict", "follow.mode.strict"],
      ["smart", "follow.mode.smart"],
    ],
  },
  uncertain_mode: {
    label: "follow.setting.uncertain_mode",
    options: [
      ["follow", "follow.chip"],
      ["hold", "follow.phase.holding"],
    ],
  },
} as const satisfies Partial<Record<FollowSettingKey, { label: string; options: readonly (readonly [string, string])[] }>>;

function FollowSettingToggle({
  droneId,
  setting,
  echoed,
  className,
}: {
  droneId: string;
  setting: keyof typeof SEGMENTED;
  /** The echoed value from `follow.state`. */
  echoed: string | null;
  className?: string;
}) {
  const spec = SEGMENTED[setting];
  const { value, pending, select } = useFollowSetting<string>(droneId, setting, echoed);
  return (
    <div
      role="group"
      aria-label={specString(spec.label)}
      className={cn("reacq", className)}
      data-testid={`follow-setting-${setting}`}
    >
      {spec.options.map(([v, word]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          data-pending={pending === v ? "true" : undefined}
          title={pending === v ? specString("follow.pending") : undefined}
          onClick={() => select(v)}
        >
          {specString(word)}
        </button>
      ))}
    </div>
  );
}

/** The predictive search switch (`predictive_search`). */
function PredictiveSearchToggle({
  droneId,
  echoed,
  className,
}: {
  droneId: string;
  echoed: boolean | null;
  className?: string;
}) {
  const { value, pending, select } = useFollowSetting<boolean>(droneId, "predictive_search", echoed);
  const on = value === true;
  return (
    <div className={cn("reacq", className)}>
      <button
        type="button"
        aria-pressed={on}
        data-pending={pending !== null ? "true" : undefined}
        title={pending !== null ? specString("follow.pending") : undefined}
        data-testid="follow-setting-predictive_search"
        onClick={() => select(!on)}
      >
        {specString("follow.setting.predictive_search")}
      </button>
    </div>
  );
}
