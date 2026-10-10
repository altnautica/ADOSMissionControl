/**
 * The single confirm host for the skill dispatch pipeline. Subscribes to the
 * skill-confirm store and renders the confirm sheet for a pending
 * ConfirmPolicy, resolving the dispatcher's awaited promise with the
 * operator's decision. The sheet is keyed to the request id, so each request
 * starts fresh (full guard window, empty hold, override off). Mounts once,
 * alongside the other shell-wide bridges.
 *
 * @module cockpit/SkillConfirmHost
 * @license GPL-3.0-only
 */

"use client";

import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { ConfirmSheet } from "./confirm/ConfirmSheet";

export function SkillConfirmHost() {
  const pending = useSkillConfirmStore((s) => s.pending);
  const resolvePending = useSkillConfirmStore((s) => s.resolvePending);

  if (!pending) return null;

  return (
    <ConfirmSheet
      key={pending.id}
      policy={pending.policy}
      droneId={pending.droneId}
      onResolve={resolvePending}
    />
  );
}
