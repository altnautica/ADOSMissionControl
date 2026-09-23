/**
 * @module RadioNetworkHealthStore
 * @description Zustand store backing the Radio / Network Health panel. The
 * live link/adapter indicators come from the heartbeat-backed
 * `agent-capabilities` store (read in the component); this store owns the
 * durable event history, read from `client.logging` for the radio/network
 * event kinds. The feed is keyed to the device it was read for: a load for
 * another device replaces it, and a late response for a device no longer shown
 * is dropped. Reads degrade gracefully: an older agent (no durable store) or
 * no direct connection leaves the feed empty and `available=false` rather
 * than throwing, so the panel falls back to the live heartbeat indicators.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { EventsRow } from "@/lib/agent/agent-client/logging";
import type { AgentClient } from "@/lib/agent/client";
import {
  RADIO_NETWORK_EVENT_KINDS,
  mapRadioNetworkEvents,
  type RadioNetworkActivity,
} from "@/lib/agent/radio-network-events";

/** How many activity rows to keep + render. */
const MAX_ACTIVITY = 15;
/** How many rows to pull from the store before mapping + capping. A small
 * over-fetch covers the case where the newest rows span several kinds. */
const QUERY_LIMIT = 60;
/** Look back over the last day so a freshly-opened panel shows recent
 * boot-window reg-pins + self-heals without an unbounded scan. */
const LOOKBACK = "-24h";
/** A WiFi self-heal counts as "recent" (live indicator stays warning) for
 * this window after it fired. */
const WIFI_RECENT_WINDOW_MS = 5 * 60_000;

interface RadioNetworkHealthState {
  /** The device the feed below belongs to (and the latest load targets). */
  deviceId: string | null;
  /** Recent radio/network events, newest first, capped at MAX_ACTIVITY. */
  recentEvents: RadioNetworkActivity[];
  /** True when the most recent onboard-WiFi self-heal fired inside the
   * recent window at load time. Derived in the store (not in render) so the
   * freshness clock read stays out of the component's pure body. */
  wifiReassocRecent: boolean;
  /** True once the durable store answered for `deviceId`. */
  available: boolean;
  loading: boolean;
  /** Set when the last load threw for a reason other than "store absent". */
  error: string | null;
  lastFetch: number | null;
}

interface RadioNetworkHealthActions {
  /** Query `client`'s durable store for the radio/network event kinds on
   * behalf of `deviceId`. Swallows unreachable-store errors (older agent / no
   * direct connection) so the panel still renders the live heartbeat
   * indicators. */
  loadEvents: (deviceId: string | null, client: AgentClient | null) => Promise<void>;
  /** Reset on panel unmount. */
  clear: () => void;
}

export type RadioNetworkHealthStore = RadioNetworkHealthState &
  RadioNetworkHealthActions;

const initialState: RadioNetworkHealthState = {
  deviceId: null,
  recentEvents: [],
  wifiReassocRecent: false,
  available: false,
  loading: false,
  error: null,
  lastFetch: null,
};

export const useRadioNetworkHealthStore = create<RadioNetworkHealthStore>(
  (set, get) => ({
    ...initialState,

    async loadEvents(deviceId, client) {
      // A load for another device drops the previous device's feed at once.
      if (get().deviceId !== deviceId) set({ ...initialState, deviceId });
      // No logging surface at all (older agent build, or no direct connection
      // to this node): leave the feed empty and unavailable so the panel shows
      // live state only.
      if (!client?.logging) {
        set({ available: false, loading: false });
        return;
      }
      set({ loading: true });
      try {
        const envelope = await client.logging.query<EventsRow>({
          kind: "events",
          event_kind: [...RADIO_NETWORK_EVENT_KINDS],
          from: LOOKBACK,
          limit: QUERY_LIMIT,
        });
        if (get().deviceId !== deviceId) return;
        const recentEvents = mapRadioNetworkEvents(envelope.data, MAX_ACTIVITY);
        // Freshness clock read happens here (the store), not in the
        // component's pure render body.
        const now = Date.now();
        const lastWifi = recentEvents.find(
          (e) => e.kind === "network.wifi_reassociated",
        );
        const wifiReassocRecent =
          lastWifi != null && now - lastWifi.tsUs / 1000 < WIFI_RECENT_WINDOW_MS;
        set({
          recentEvents,
          wifiReassocRecent,
          available: true,
          loading: false,
          error: null,
          lastFetch: now,
        });
      } catch (err) {
        if (get().deviceId !== deviceId) return;
        // The durable store is unreachable (network error or a pre-logd
        // agent). Degrade to "no events" without crashing; the panel keeps
        // showing the live heartbeat indicators.
        set({
          available: false,
          loading: false,
          error: err instanceof Error ? err.message : null,
        });
      }
    },

    clear() {
      set({ ...initialState });
    },
  }),
);
