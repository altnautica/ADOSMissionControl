"use client";

/**
 * Top-of-shell banner shown the first time Mission Control sees a flight
 * controller (by its AUTOPILOT_VERSION uid, from the agent's setup engine)
 * that has no completed ground setup. It links to the aircraft setup wizard.
 * Following the link or skipping it marks that uid as offered, so it shows
 * once per aircraft on this browser. A direct-serial FC (no agent setup
 * engine) never shows it.
 *
 * @module components/shared/AircraftSetupBanner
 * @license GPL-3.0-only
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wrench, X } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import { useAgentFcSetup } from "@/lib/fc-setup/use-fc-setup";
import { useDroneManager } from "@/stores/drone-manager";

/** The aircraft setup wizard (Settings › Aircraft setup). */
export const AIRCRAFT_SETUP_HREF = "/config/aircraft-setup";

/** localStorage key: the FC uids this browser has already offered setup for. */
export const SETUP_OFFERED_KEY = "altcmd:aircraft-setup-offered";

function readOffered(): string[] {
  try {
    const raw = window.localStorage.getItem(SETUP_OFFERED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function markOffered(uid: string): void {
  const list = readOffered();
  if (list.includes(uid)) return;
  try {
    window.localStorage.setItem(SETUP_OFFERED_KEY, JSON.stringify([...list, uid]));
  } catch {
    // Storage full or blocked: the banner then shows again next session.
  }
}

export function AircraftSetupBanner(): React.ReactElement | null {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const setup = useAgentFcSetup(selectedDroneId);
  const pathname = usePathname();
  // Uids dismissed in this session, so the banner hides at once.
  const [dismissed, setDismissed] = useState<string[]>([]);

  const status = setup?.status ?? null;
  const uid = status?.uid ?? null;
  const ground = status?.wizards.find((w) => w.id === "ground") ?? null;
  if (!uid || !ground || ground.state === "done") return null;
  if (pathname?.startsWith(AIRCRAFT_SETUP_HREF)) return null;
  if (dismissed.includes(uid) || readOffered().includes(uid)) return null;

  const close = () => {
    markOffered(uid);
    setDismissed((d) => [...d, uid]);
  };

  return (
    <div
      role="status"
      data-testid="aircraft-setup-banner"
      className="flex items-center justify-between gap-3 border-b border-accent-primary/40 bg-accent-primary/10 px-4 py-2 text-[11px] text-text-primary"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Wrench size={12} className="shrink-0 text-accent-primary" aria-hidden />
        <span className="font-semibold">{specString("readiness.setup_needed")}</span>
        <span className="truncate text-text-secondary">{specString("setup.wizard.ground.body")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={AIRCRAFT_SETUP_HREF}
          onClick={close}
          data-testid="aircraft-setup-banner-open"
          className="border border-accent-primary/60 px-2 py-0.5 text-[10px] font-semibold text-accent-primary hover:bg-accent-primary/20"
        >
          {specString("setup.wizard.entry.set_up_aircraft")}
        </Link>
        <button
          type="button"
          onClick={close}
          aria-label={specString("setup.action.skip")}
          className="flex cursor-pointer items-center gap-1 px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
        >
          <X size={10} aria-hidden />
          {specString("setup.action.skip")}
        </button>
      </div>
    </div>
  );
}
