"use client";

/**
 * @module TestUtilitiesSection
 * @description Test utilities composer for the DroneCAN CAN Config page.
 * Renders six sub-cards, each a self-contained tool under
 * `./test-utilities/`:
 *
 *   1. Node ping — GetNodeInfo RTT with a five-entry rolling history.
 *   2. Manual frame inject — single CAN frame send with echo detection.
 *   3. Node-ID conflict scanner — sweeps known nodes for duplicate ids.
 *   4. ESC RawCommand sweep, behind a props-off confirmation.
 *   5. GPS fix snapshot (Fix2 subscription).
 *   6. Compass raw stream (MagneticFieldStrength2 subscription).
 *
 * Sub-tools that need live wiring accept the `client` and `transport`
 * props on this composer. Both are optional so the section renders in
 * demo mode and on pages where the wiring hasn't landed.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import type { DroneCanClient } from "@/lib/dronecan/client";
import type { CanTransport } from "@/lib/protocol/transport/can-transport";
import { NodePingCard } from "./test-utilities/NodePingCard";
import { ManualFrameInjectCard } from "./test-utilities/ManualFrameInjectCard";
import { ConflictScanCard } from "./test-utilities/ConflictScanCard";
import { EscSweepCard } from "./test-utilities/EscSweepCard";
import { GpsFixSnapshotCard } from "./test-utilities/GpsFixSnapshotCard";
import { CompassStreamCard } from "./test-utilities/CompassStreamCard";

export interface TestUtilitiesSectionProps {
  client?:
    | Pick<
        DroneCanClient,
        | "getNodeInfo"
        | "onNodeStatus"
        | "sendEscRawCommand"
        | "subscribeFix2"
        | "subscribeMag2"
      >
    | null;
  transport?: Pick<CanTransport, "send"> | null;
}

export function TestUtilitiesSection({
  client = null,
  transport = null,
}: TestUtilitiesSectionProps) {
  const t = useTranslations("canConfig.testUtilities");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-text-primary">{t("title")}</h3>
        <p className="text-[11px] text-text-tertiary mt-0.5">{t("subtitle")}</p>
      </div>

      <NodePingCard client={client} />
      <ManualFrameInjectCard transport={transport} />
      <ConflictScanCard client={client} />
      <EscSweepCard client={client} />
      <GpsFixSnapshotCard client={client} />
      <CompassStreamCard client={client} />
    </div>
  );
}
