"use client";

/**
 * @module use-describe-agent-error
 * @description The operator sentence for a failed agent call: known agent
 * error codes read as localized text, other refusals as the agent's own
 * reason, everything else as the caller's localized fallback.
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { describeAgentError } from "@/lib/agent/agent-client/transport";

export function useDescribeAgentError(): (err: unknown, fallback: string) => string {
  const t = useTranslations("agentErrors");
  return useCallback((err: unknown, fallback: string) => describeAgentError(err, fallback, t), [t]);
}
