/**
 * @module telemetry/adsb-traffic
 * @description Turns the per-contact MAVLink ADSB_VEHICLE stream into the
 * traffic list the telemetry store holds.
 *
 * ADSB_VEHICLE arrives one aircraft per message, while the store keeps a
 * whole list (the MSP path replaces it from a polled list). This table keys
 * contacts by ICAO address and drops a contact once nothing has been heard
 * for TELEMETRY_STALE_MS, so an aircraft that left receiver range does not
 * stay on the traffic list at its last position.
 * @license GPL-3.0-only
 */

import type { AdsbContact } from "@/lib/protocol/types";
import type { INavAdsbVehicle } from "@/lib/protocol/msp/msp-decoders-inav";
import { TELEMETRY_STALE_MS } from "./freshness";

const PRUNE_INTERVAL_MS = 1_000;

export interface AdsbTrafficTable {
  update(contact: AdsbContact): void;
  dispose(): void;
}

function toListEntry(c: AdsbContact, now: number): INavAdsbVehicle {
  const heardAgoMs = c.tslc * 1000 + (now - c.timestamp);
  return {
    callsign: c.callsign ?? "",
    icao: c.icao,
    lat: c.lat,
    lon: c.lon,
    // The list carries altitude in cm; an invalid altitude stays NaN rather
    // than reading as sea level.
    alt: c.altitudeM === undefined ? Number.NaN : Math.round(c.altitudeM * 100),
    heading: c.headingDeg ?? Number.NaN,
    lastSeenMs: heardAgoMs,
    emitterType: c.emitterType,
    ttlSec: Math.max(0, Math.ceil((TELEMETRY_STALE_MS - (now - c.timestamp)) / 1000)),
  };
}

/**
 * `publish` receives the current list after every change, including the empty
 * list when the last contact expires.
 */
export function createAdsbTrafficTable(
  publish: (vehicles: INavAdsbVehicle[]) => void,
  now: () => number = Date.now,
): AdsbTrafficTable {
  const contacts = new Map<number, AdsbContact>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const emit = () => {
    const t = now();
    publish(Array.from(contacts.values(), (c) => toListEntry(c, t)));
  };

  const prune = () => {
    const t = now();
    let changed = false;
    for (const [icao, c] of contacts) {
      if (t - c.timestamp > TELEMETRY_STALE_MS) {
        contacts.delete(icao);
        changed = true;
      }
    }
    if (contacts.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
    if (changed) emit();
  };

  return {
    update(contact) {
      contacts.set(contact.icao, contact);
      timer ??= setInterval(prune, PRUNE_INTERVAL_MS);
      emit();
    },
    dispose() {
      clearInterval(timer);
      timer = undefined;
      contacts.clear();
    },
  };
}
