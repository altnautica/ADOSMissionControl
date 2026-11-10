"use client";

/**
 * Non-modal shell banner offering the aircraft setup wizard the first time
 * this device sees a flight controller (by its AUTOPILOT_VERSION uid, from the
 * agent's setup engine) whose ground setup is not done. Open follows it to the
 * wizard and Later puts it off; either records the uid, so each aircraft is
 * offered once per device. It shows only on the ground: never while a flight
 * screen is mounted or a vehicle reports armed. A direct-serial FC (no agent
 * setup engine) never shows it.
 *
 * @module components/shared/AircraftSetupBanner
 * @license GPL-3.0-only
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wrench, X } from "lucide-react";

import { useShellModalsAllowed } from "@/hooks/use-shell-modals-allowed";
import { specString } from "@/lib/cockpit/spec-strings";
import { useAgentFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { useAircraftSetupOfferStore } from "@/stores/aircraft-setup-offer-store";
import { useDroneManager } from "@/stores/drone-manager";

/** The aircraft setup wizard (Settings › Aircraft setup). */
export const AIRCRAFT_SETUP_HREF = "/config/aircraft-setup";

export function AircraftSetupBanner(): React.ReactElement | null {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const setup = useAgentFcSetup(selectedDroneId);
  const pathname = usePathname();
  // On the ground only: no flight screen mounted and nothing armed.
  const onGround = useShellModalsAllowed();
  const offered = useAircraftSetupOfferStore((s) => s.offered);
  const markOffered = useAircraftSetupOfferStore((s) => s.markOffered);

  const status = setup?.status ?? null;
  const uid = status?.uid ?? null;
  const ground = status?.wizards.find((w) => w.id === "ground") ?? null;
  if (!uid || !ground || ground.state === "done") return null;
  if (!onGround || offered.includes(uid)) return null;
  if (pathname?.startsWith(AIRCRAFT_SETUP_HREF)) return null;

  return (
    <div
      role="status"
      data-testid="aircraft-setup-banner"
      className="flex items-center justify-between gap-3 border-b border-accent-primary/40 bg-accent-primary/10 px-4 py-2 text-[11px] text-text-primary"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Wrench size={12} className="shrink-0 text-accent-primary" aria-hidden />
        <span className="truncate font-semibold">{specString("setup.wizard.entry.set_up_aircraft")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={AIRCRAFT_SETUP_HREF}
          onClick={() => markOffered(uid)}
          data-testid="aircraft-setup-banner-open"
          className="border border-accent-primary/60 px-2 py-0.5 text-[10px] font-semibold text-accent-primary hover:bg-accent-primary/20"
        >
          {specString("setup.action.start")}
        </Link>
        <button
          type="button"
          onClick={() => markOffered(uid)}
          data-testid="aircraft-setup-banner-later"
          className="flex cursor-pointer items-center gap-1 px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
        >
          <X size={10} aria-hidden />
          {specString("setup.action.skip")}
        </button>
      </div>
    </div>
  );
}
