"use client";

/**
 * @module cockpit/FollowRail
 * @description The following-mode right rail (widget layer, right edge,
 * vertically centred on a glass plate). Buttons: FOLLOW / TRACKING (the
 * follow-me toggle skill), STRICT | SMART, FRONT ⇄ BELLY (two concurrent
 * legs, one a belly camera), REC, then at `expanded`/`tv` HOLD, RTL and LAND.
 * Every skill button dispatches the Skill Bar's own skill id through the same
 * `activate()` gate, so disabled state, debounce and confirm sheet are
 * shared rather than reimplemented. Kill is not on the rail.
 *
 * @license GPL-3.0-only
 */

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeftRight,
  Circle,
  Crosshair,
  Home,
  MoreHorizontal,
  Pause,
  PlaneLanding,
  X,
} from "lucide-react";

import { activateBound, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { camSwapPlan } from "@/lib/cockpit/cam-swap";
import { cn } from "@/lib/utils";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import {
  safeRegionHeight,
  useCockpitLayoutSize,
} from "@/hooks/use-cockpit-width-class";
import { FOLLOW_SKILL_ID, useFollowingMode } from "@/hooks/use-following-mode";
import {
  ROLE_LABEL_KEY,
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";
import { ReacquireModeToggle } from "./ReacquireModeToggle";

/** At `compact`, CAM and REC fold behind ⋯ below this safe height (px). */
export const RAIL_FOLD_SAFE_HEIGHT_PX = 360;

interface RailButtonProps {
  icon: ReactNode;
  word: string;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  tone?: "track" | "crit";
  testId?: string;
}

function RailButton({ icon, word, label, onClick, disabled, pressed, tone, testId }: RailButtonProps) {
  return (
    <button
      type="button"
      className={cn("frail-btn", tone && `tone-${tone}`)}
      aria-label={label ?? word}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <span className="frail-ic" aria-hidden="true">{icon}</span>
      <span className="frail-word">{word}</span>
    </button>
  );
}

/** A mirror of a Skill Bar skill; hidden when the skill is not registered. */
function RailSkillButton({
  droneId,
  skillId,
  icon,
  word,
}: {
  droneId: string;
  skillId: string;
  icon: ReactNode;
  word: string;
}) {
  const registered = useSkillRegistry((s) => s.skills.has(skillId));
  const kind = useSkillRegistry((s) => s.states.get(droneId)?.get(skillId)?.kind);
  if (!registered) return null;
  return (
    <RailButton
      icon={icon}
      word={word}
      disabled={kind === "disabled"}
      onClick={() => void activateBound(skillId, buildSkillContext(droneId))}
      testId={`frail-skill-${skillId}`}
    />
  );
}

function useLegLabel(): (leg: StreamDescriptor) => string {
  const t = useTranslations("cockpitStreams");
  return (leg) => {
    const key = leg.role ? ROLE_LABEL_KEY[leg.role] : undefined;
    return key ? t(key) : leg.label;
  };
}

export function FollowRail({ droneId }: { droneId: string }) {
  const t = useTranslations("hud.rail");
  const layout = useCockpitLayoutSize();
  const { follow, following, installed } = useFollowingMode(droneId);
  const followKind = useSkillRegistry((s) => s.states.get(droneId)?.get(FOLLOW_SKILL_ID)?.kind);
  const streams = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const pipId = useVideoStreamsStore((s) => s.pipStreamIdByDrone[droneId]);
  const { isRecording, toggle: toggleRec } = useFlightRecording(droneId);
  const legLabel = useLegLabel();
  const [moreOpen, setMoreOpen] = useState(false);

  if (!following) return null;

  const { widthClass } = layout;
  const wide = widthClass === "expanded" || widthClass === "tv";
  const fold = widthClass === "compact" && safeRegionHeight(layout) < RAIL_FOLD_SAFE_HEIGHT_PX;
  const tracking = followKind === "active" || (follow !== null && follow.phase !== "idle");
  const swap = camSwapPlan(streams ?? [], activeId ?? streams?.[0]?.id, pipId);

  const swapButton = swap && (
    <RailButton
      icon={<ArrowLeftRight size={18} />}
      word={t("camSwap", { a: legLabel(swap.pip), b: legLabel(swap.main) })}
      testId="frail-camswap"
      onClick={() => {
        const st = useVideoStreamsStore.getState();
        st.selectStream(droneId, swap.main.id);
        st.setPip(droneId, swap.pip.id);
      }}
    />
  );
  const recButton = (
    <RailButton
      icon={<Circle size={18} fill={isRecording ? "currentColor" : "none"} />}
      word={isRecording ? t("stop") : t("rec")}
      pressed={isRecording}
      tone={isRecording ? "crit" : undefined}
      testId="frail-rec"
      onClick={toggleRec}
    />
  );

  return (
    <nav
      className="frail"
      data-width-class={widthClass}
      aria-label={t("label")}
      data-testid="follow-rail"
    >
      {installed && (
        <RailButton
          icon={tracking ? <X size={18} /> : <Crosshair size={18} />}
          word={tracking ? `${t("tracking")} ×` : `${t("follow")} ▸`}
          label={tracking ? t("stopFollow") : t("follow")}
          pressed={tracking}
          tone={tracking ? "track" : undefined}
          disabled={followKind === "disabled"}
          testId="frail-follow"
          onClick={() => void activateBound(FOLLOW_SKILL_ID, buildSkillContext(droneId))}
        />
      )}
      {installed && (
        <ReacquireModeToggle
          droneId={droneId}
          echoed={follow?.reacquireMode ?? null}
          vertical
          className="frail-seg"
        />
      )}
      {fold ? (
        <>
          <RailButton
            icon={<MoreHorizontal size={18} />}
            word={t("more")}
            pressed={moreOpen}
            testId="frail-more"
            onClick={() => setMoreOpen((open) => !open)}
          />
          {moreOpen && (
            <div className="frail-fold" data-testid="frail-fold">
              {swapButton}
              {recButton}
            </div>
          )}
        </>
      ) : (
        <>
          {swapButton}
          {recButton}
        </>
      )}
      {wide && (
        <>
          <hr className="frail-div" />
          <RailSkillButton droneId={droneId} skillId="pause" icon={<Pause size={18} />} word={t("hold")} />
          <RailSkillButton droneId={droneId} skillId="rth" icon={<Home size={18} />} word={t("rtl")} />
          <RailSkillButton droneId={droneId} skillId="land" icon={<PlaneLanding size={18} />} word={t("land")} />
        </>
      )}
    </nav>
  );
}
