"use client";

/**
 * @module cockpit/FollowRail
 * @description The following-mode controls, one row in the follow strip under
 * the top bar: FOLLOW / TRACKING (the follow-me toggle skill), the quick
 * settings (STRICT | SMART re-acquire, FOLLOW | HOLD when unsure, the
 * predictive search switch), and FRONT ⇄ BELLY (two concurrent legs, one a
 * belly camera). REC joins them only where the flight screen has no right
 * column (portrait), since the right column's shutter records everywhere
 * else. Hold, return and land are the left column's, never repeated here.
 * The follow skill dispatches through the shared `activate()` gate, so
 * disabled state, debounce and the confirm sheet are shared rather than
 * reimplemented.
 *
 * Given the strip's width, the rail fits beside the range readout
 * (`followRailLayout`): on a narrow strip, a portrait phone, the quick
 * settings fold behind More, which opens them as a sheet under the strip,
 * and then the buttons drop their words. FOLLOW, the camera swap, REC and
 * the readout stay on the row.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { ArrowLeftRight, Circle, Crosshair, Ellipsis, X } from "lucide-react";

import { activateBound, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { specString } from "@/lib/cockpit/spec-strings";
import { camSwapPlan } from "@/lib/cockpit/cam-swap";
import { followRailLayout, type FollowRailButton } from "@/lib/cockpit/follow-rail-layout";
import { cn } from "@/lib/utils";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { FOLLOW_SKILL_ID, useFollowingMode } from "@/hooks/use-following-mode";
import {
  streamRoleLabel,
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";
import { FollowQuickSettings, useFollowQuickSettings } from "./FollowSettingToggle";

/** Marks the More button, so a press on it is not "outside" its sheet. */
export const FOLLOW_SETTINGS_TRIGGER = "data-follow-settings-trigger";

interface RailButtonProps {
  icon: ReactNode;
  word: string;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  iconOnly?: boolean;
  tone?: "track" | "crit";
  testId?: string;
  trigger?: boolean;
}

function RailButton({ icon, word, label, onClick, disabled, pressed, expanded, iconOnly, tone, testId, trigger }: RailButtonProps) {
  return (
    <button
      type="button"
      className={cn("frail-btn", iconOnly && "frail-icon-only", tone && `tone-${tone}`)}
      aria-label={label ?? word}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={iconOnly ? (label ?? word) : undefined}
      data-testid={testId}
      {...(trigger ? { [FOLLOW_SETTINGS_TRIGGER]: "" } : {})}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <span className="frail-ic" aria-hidden="true">{icon}</span>
      {!iconOnly && <span className="frail-word">{word}</span>}
    </button>
  );
}

export interface FollowRailProps {
  droneId: string;
  withRec?: boolean;
  /** The strip's width; without it the rail never folds. */
  stripW?: number;
  /** The quick settings sheet is open (folded rail only). */
  settingsOpen?: boolean;
  /** Toggle the quick settings sheet (folded rail only). */
  onToggleSettings?: () => void;
}

export function FollowRail({ droneId, withRec = false, stripW, settingsOpen = false, onToggleSettings }: FollowRailProps) {
  const { follow, following, installed } = useFollowingMode(droneId);
  const followKind = useSkillRegistry((s) => s.states.get(droneId)?.get(FOLLOW_SKILL_ID)?.kind);
  const streams = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const pipId = useVideoStreamsStore((s) => s.pipStreamIdByDrone[droneId]);
  const { isRecording, toggle: toggleRec } = useFlightRecording(droneId);
  const settings = useFollowQuickSettings(droneId);
  const legLabel = (leg: StreamDescriptor) => streamRoleLabel(leg.role) ?? leg.label;

  if (!following) return null;

  const tracking = followKind === "active" || (follow !== null && follow.phase !== "idle");
  const swap = camSwapPlan(streams ?? [], activeId ?? streams?.[0]?.id, pipId);

  const words: Record<FollowRailButton, string> = {
    follow: tracking ? specString("follow.tracking_close") : `${specString("follow.chip")} ▸`,
    camSwap: swap ? specString("follow.cam_swap", { from: legLabel(swap.pip), to: legLabel(swap.main) }) : "",
    rec: isRecording ? specString("cockpit.stop") : specString("follow.rec"),
  };
  const buttons: FollowRailButton[] = [];
  if (installed) buttons.push("follow");
  if (swap) buttons.push("camSwap");
  if (withRec) buttons.push("rec");
  const { foldSettings, iconOnly } = followRailLayout({
    stripW: stripW ?? null,
    buttons: buttons.map((id) => ({ id, word: words[id] })),
    settings,
    predictiveWord: specString("follow.setting.predictive_search"),
    moreWord: specString("follow.more"),
  });

  return (
    <nav className="frail" aria-label={specString("follow.controls")} data-testid="follow-rail">
      {installed && (
        <RailButton
          icon={tracking ? <X size={16} /> : <Crosshair size={16} />}
          word={words.follow}
          label={tracking ? specString("follow.stop_following") : specString("follow.chip")}
          pressed={tracking}
          tone={tracking ? "track" : undefined}
          disabled={followKind === "disabled"}
          iconOnly={iconOnly}
          testId="frail-follow"
          onClick={() => void activateBound(FOLLOW_SKILL_ID, buildSkillContext(droneId))}
        />
      )}
      {settings.length > 0 &&
        (foldSettings ? (
          <RailButton
            icon={<Ellipsis size={16} />}
            word={specString("follow.more")}
            label={specString("follow.more_controls")}
            expanded={settingsOpen}
            iconOnly={iconOnly}
            testId="frail-more"
            trigger
            onClick={() => onToggleSettings?.()}
          />
        ) : (
          <FollowQuickSettings droneId={droneId} className="frail-seg" />
        ))}
      {swap && (
        <RailButton
          icon={<ArrowLeftRight size={16} />}
          word={words.camSwap}
          iconOnly={iconOnly}
          testId="frail-camswap"
          onClick={() => {
            const st = useVideoStreamsStore.getState();
            st.selectStream(droneId, swap.main.id);
            st.setPip(droneId, swap.pip.id);
          }}
        />
      )}
      {withRec && (
        <RailButton
          icon={<Circle size={16} fill={isRecording ? "currentColor" : "none"} />}
          word={words.rec}
          pressed={isRecording}
          tone={isRecording ? "crit" : undefined}
          iconOnly={iconOnly}
          testId="frail-rec"
          onClick={toggleRec}
        />
      )}
    </nav>
  );
}
