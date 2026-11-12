"use client";

/**
 * @module ground-station/DashboardPinUnlockCard
 * @description Unlock a ground station Mission Control holds no key for.
 *
 * An unpaired node refuses its data plane, ground-station WebSocket relays
 * included, to an operator-LAN browser without a dashboard PIN session. This
 * card takes the node's dashboard PIN once; the session it returns rides every
 * later ground-station request and WS ticket mint in place of `X-ADOS-Key`.
 * Hidden when the node is reached with a key, in demo, or with no direct URL.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
import { dashboardSessionFor, verifyDashboardPin } from "@/lib/agent/local-pair-client";
import { isDemoMode } from "@/lib/utils";

const PIN_LENGTH = 4;

export function DashboardPinUnlockCard({ nodeDeviceId }: { nodeDeviceId: string | null }) {
  const tq = useTranslations("command.dashboardPinUnlockCard");
  const direct = useNodeDirectAgent(nodeDeviceId);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful unlock so the held session is re-read.
  const [, setUnlockedAt] = useState(0);

  if (isDemoMode() || !direct || direct.apiKey) return null;
  const agentUrl = direct.agentUrl;

  if (dashboardSessionFor(agentUrl)) {
    return (
      <p role="status" className="mb-3 text-xs text-text-tertiary">
        {tq("unlockedWithThisNodeApos")}
      </p>
    );
  }

  const onUnlock = async () => {
    if (pin.length !== PIN_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyDashboardPin(agentUrl, pin);
      setPin("");
      setUnlockedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded border border-status-warning/40 bg-status-warning/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-text-primary">
        <KeyRound size={14} className="text-status-warning" aria-hidden="true" />
        <h3 className="text-sm font-medium">{tq("thisGroundStationIsNot")}</h3>
      </div>
      <p className="mb-3 text-xs text-text-secondary">
        {tq("missionControlHoldsNoKey")}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onUnlock();
        }}
      >
        <label className="text-xs text-text-secondary">
          {tq("dashboardPIN")}
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={PIN_LENGTH}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
            className="mt-1 block w-24 border border-border-default bg-bg-tertiary px-2 py-1 font-mono text-sm text-text-primary"
          />
        </label>
        <Button type="submit" size="sm" disabled={busy || pin.length !== PIN_LENGTH}>
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-status-error">
          {error}
        </p>
      )}
    </section>
  );
}
