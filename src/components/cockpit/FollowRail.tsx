"use client";

/**
 * @module cockpit/FollowRail
 * @description The following-mode controls, one row in the follow strip under
 * the top bar: FOLLOW / TRACKING (the follow-me toggle skill), STRICT |
 * SMART, and FRONT ⇄ BELLY (two concurrent legs, one a belly camera). REC
 * joins them only where the flight screen has no right column (portrait),
 * since the right column's shutter records everywhere else. Hold, return and
 * land are the left column's, never repeated here. The follow skill
 * dispatches through the shared `activate()` gate, so disabled state,
 * debounce and the confirm sheet are shared rather than reimplemented.
 *
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, Circle, Crosshair, X } from "lucide-react";

import { activateBound, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { camSwapPlan } from "@/lib/cockpit/cam-swap";
import { cn } from "@/lib/utils";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { FOLLOW_SKILL_ID, useFollowingMode } from "@/hooks/use-following-mode";
import {
  ROLE_LABEL_KEY,
  useVideoStreamsStore,
  type StreamDescriptor,
} from "@/stores/video-streams-store";
import { ReacquireModeToggle } from "./ReacquireModeToggle";

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

function useLegLabel(): (leg: StreamDescriptor) => string {
  const t = useTranslations("cockpitStreams");
  return (leg) => {
    const key = leg.role ? ROLE_LABEL_KEY[leg.role] : undefined;
    return key ? t(key) : leg.label;
  };
}

export function FollowRail({ droneId, withRec = false }: { droneId: string; withRec?: boolean }) {
  const t = useTranslations("hud.rail");
  const { follow, following, installed } = useFollowingMode(droneId);
  const followKind = useSkillRegistry((s) => s.states.get(droneId)?.get(FOLLOW_SKILL_ID)?.kind);
  const streams = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const pipId = useVideoStreamsStore((s) => s.pipStreamIdByDrone[droneId]);
  const { isRecording, toggle: toggleRec } = useFlightRecording(droneId);
  const legLabel = useLegLabel();

  if (!following) return null;

  const tracking = followKind === "active" || (follow !== null && follow.phase !== "idle");
  const swap = camSwapPlan(streams ?? [], activeId ?? streams?.[0]?.id, pipId);

  return (
    <nav className="frail" aria-label={t("label")} data-testid="follow-rail">
      {installed && (
        <RailButton
          icon={tracking ? <X size={16} /> : <Crosshair size={16} />}
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
        <ReacquireModeToggle droneId={droneId} echoed={follow?.reacquireMode ?? null} className="frail-seg" />
      )}
      {swap && (
        <RailButton
          icon={<ArrowLeftRight size={16} />}
          word={t("camSwap", { a: legLabel(swap.pip), b: legLabel(swap.main) })}
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
          word={isRecording ? t("stop") : t("rec")}
          pressed={isRecording}
          tone={isRecording ? "crit" : undefined}
          testId="frail-rec"
          onClick={toggleRec}
        />
      )}
    </nav>
  );
}
