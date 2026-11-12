/**
 * @module use-describe-upload-failure
 * @description Puts a failed mission upload into the operator's words: a
 * MAV_MISSION_RESULT or transfer outcome reads as a sentence, never a number.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { missionResultKey } from "@/lib/protocol/mission-result";

/**
 * Returns `(code, detail) => text`: with a code, the localized wording for
 * it; without one, `detail`, which is then already operator text (a refusal
 * made before anything was sent). Null when there is nothing to say.
 */
export function useDescribeUploadFailure(): (code: number | null, detail: string | null) => string | null {
  const t = useTranslations("planner.send.result");
  return useCallback(
    (code, detail) => (code !== null ? t(missionResultKey(code), { code }) : detail),
    [t],
  );
}
