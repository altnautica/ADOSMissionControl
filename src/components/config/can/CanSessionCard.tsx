"use client";

/**
 * @module CanSessionCard
 * @description Opens and closes the CAN page's DroneCAN session and says
 * plainly whether one exists, so the sections that need a live client never
 * show zeros for a bus nobody is listening to.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { DroneCanSessionState } from "./use-dronecan-session";

const BUS_OPTIONS = [
  { value: "1", label: "CAN1" },
  { value: "2", label: "CAN2" },
];

interface CanSessionCardProps {
  state: DroneCanSessionState;
  canForward: boolean;
  onOpen: (bus: number) => void;
  onClose: () => void;
}

export function CanSessionCard({ state, canForward, onOpen, onClose }: CanSessionCardProps) {
  const t = useTranslations("canConfig.session");
  const [bus, setBus] = useState("1");

  return (
    <Card>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-text-primary">{t("title")}</span>
        {state.status === "open" ? (
          <>
            <span className="text-[11px] text-status-success flex-1">{t("active", { bus: state.bus })}</span>
            <Button variant="ghost" size="sm" onClick={onClose}>{t("close")}</Button>
          </>
        ) : (
          <>
            <div className="w-28">
              <Select label={t("bus")} options={BUS_OPTIONS} value={bus} onChange={setBus} disabled={state.status === "opening"} />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onOpen(Number(bus))}
              disabled={!canForward || state.status === "opening"}
            >
              {state.status === "opening" ? t("opening") : t("open")}
            </Button>
            <span className="text-[11px] text-text-tertiary flex-1">
              {canForward ? t("none") : t("unsupported")}
            </span>
          </>
        )}
      </div>
      {state.status === "closed" && state.error && (
        <p className="text-[11px] text-status-error mt-2">{t("failed", { error: state.error })}</p>
      )}
    </Card>
  );
}
