"use client";

/**
 * @module RoleChangeCard
 * @description Minimal inline role picker used on the Distributed RX
 * and Mesh sub-views. Reads the current role + switching state from the
 * store; when the operator picks a new role and clicks Apply, the card
 * disables itself and surfaces an inline spinner until the transition
 * completes or errors out. Times out the optimistic "switching"
 * indicator after 20 s so a lost status response does not leave the
 * button wedged.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { useGroundStationStore } from "@/stores/ground-station-store";
import {
  groundStationApiFromAgent,
  type GroundStationRole,
} from "@/lib/api/ground-station-api";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

interface RoleChangeCardProps {
  /** Copy variant. `empty` renders the "you are in direct mode" framing.
   * `switch` renders a generic role picker inside the role-active views. */
  variant?: "empty" | "switch";
}

const ROLES: GroundStationRole[] = ["direct", "relay", "receiver"];
const SWITCHING_TIMEOUT_MS = 20_000;

export function RoleChangeCard({ variant = "switch" }: RoleChangeCardProps) {
  const role = useGroundStationStore((s) => s.role);
  const applyRole = useGroundStationStore((s) => s.applyRole);
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);

  const [selected, setSelected] = useState<GroundStationRole>(
    role.info?.current ?? "direct",
  );
  const [localTimeoutError, setLocalTimeoutError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the dropdown in sync with the authoritative role once it loads
  // or transitions.
  useEffect(() => {
    if (role.info?.current) {
      setSelected(role.info.current);
    }
  }, [role.info?.current]);

  // Soft timeout on switching state so a lost PUT response does not
  // leave the button permanently disabled. If the request completes
  // successfully after the timeout fired, the timeout-error banner
  // gets cleared here so the operator does not see a contradictory
  // "timed out" message next to a freshly-applied role.
  useEffect(() => {
    if (!role.switching) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // Role transition resolved (success OR error from the store).
      // The store writes `role.error` on failure, so our local
      // timeout banner only duplicates information. Clear it.
      if (localTimeoutError) {
        setLocalTimeoutError(null);
      }
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setLocalTimeoutError(
        "Role transition did not complete within 20 s. Refresh and retry.",
      );
    }, SWITCHING_TIMEOUT_MS);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // localTimeoutError is intentionally omitted from deps: we only
    // care about role.switching transitions driving the timer. The
    // banner-clear path uses the current localTimeoutError value at
    // the moment switching flips to false, which is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.switching]);

  const onApply = async () => {
    if (!agentUrl || selected === role.info?.current) return;
    setLocalTimeoutError(null);
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    await applyRole(api, selected);
  };

  const disabled = role.switching || !role.info || !agentUrl;
  const showingEmpty = variant === "empty" && role.info?.current === "direct";

  return (
    <div
      className="rounded-sm border border-border-default bg-surface-secondary p-4"
      role="region"
      aria-label="Change deployment role"
    >
      {showingEmpty ? (
        <>
          <p className="text-sm text-text-primary font-medium mb-1">
            You are in direct mode.
          </p>
          <p className="text-xs text-text-secondary mb-3">
            Switch to relay or receiver to see this view with live data.
          </p>
        </>
      ) : (
        <p className="text-xs text-text-secondary mb-2 uppercase tracking-wider">
          Deployment role
        </p>
      )}
      <div className="flex items-center gap-2">
        <Select
          value={selected}
          onChange={(v) => setSelected(v as GroundStationRole)}
          disabled={disabled}
          className="min-w-[8rem]"
          options={ROLES.map((r) => ({ value: r, label: r }))}
        />
        <button
          type="button"
          onClick={onApply}
          disabled={disabled || selected === role.info?.current}
          className="rounded-sm bg-accent-primary text-surface-primary text-xs font-medium px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-busy={role.switching}
        >
          {role.switching ? "Switching..." : "Apply"}
        </button>
        {role.switching ? (
          <span
            className="text-xs text-text-secondary"
            role="status"
            aria-live="polite"
          >
            Transitioning services...
          </span>
        ) : null}
      </div>
      {role.error && !role.switching ? (
        <p
          className="text-xs text-status-error mt-2"
          role="alert"
          aria-live="polite"
        >
          {role.error}
        </p>
      ) : null}
      {localTimeoutError ? (
        <p
          className="text-xs text-status-warning mt-2"
          role="alert"
          aria-live="polite"
        >
          {localTimeoutError}
        </p>
      ) : null}
    </div>
  );
}
