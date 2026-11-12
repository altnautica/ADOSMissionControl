/**
 * @module fly-this-mission
 * @description The planner's way out to flight once a mission is on the
 * drone: select it, open its Flight tab and ask the cockpit Launch sheet to
 * open with "start the mission" chosen. The launch itself stays behind the
 * sheet's readiness checks and hold.
 * @license GPL-3.0-only
 */

import { openFlightScreen } from "@/components/cockpit/flight/open-flight-screen";
import { useLaunchRequestStore } from "@/stores/launch-request-store";

/** Route to `droneId`'s Flight tab with Launch set to start the mission; `navigate` is the router's push. */
export function flyThisMission(droneId: string, navigate: (href: string) => void): void {
  useLaunchRequestStore.getState().requestLaunch({ droneId, after: "mission" });
  openFlightScreen(droneId);
  navigate("/");
}
