/**
 * @module stores/px4-events-store
 * @description Rolling store of decoded PX4 events (MAVLink EVENT msg 410).
 * PX4 replaced STATUSTEXT with a structured events interface: the FC sends an
 * event id + packed argument bytes, and the human-readable text comes from the
 * events component-metadata. This store holds the fetched metadata + a bounded
 * list of decoded events for the selected drone, populated by the Px4 events
 * bridge. Events persist across node-detail tab switches (the feed component
 * mounts/unmounts, the store does not). Empty until the FC emits an event
 * (no fabricated rows).
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import {
  renderEventMessage,
  type EventMeta,
} from "@/lib/protocol/param-metadata/px4-event-metadata";

/** Max decoded events retained (events are low-rate; this is generous). */
const MAX_EVENTS = 500;

/** One decoded, rendered PX4 event ready to display. */
export interface DecodedEvent {
  /** Monotonic list key (stable for React). */
  key: number;
  /** Full event id. */
  id: number;
  /** Event short name from metadata, or a synthetic name if unknown. */
  name: string;
  /** Rendered message with arguments substituted. */
  text: string;
  /** External log level (0=emergency … 7=debug) for severity display. */
  severity: number;
  /** FC boot-time timestamp (ms). */
  timeBootMs: number;
  /** Wall-clock receive time. */
  receivedAt: number;
}

/** The raw fields the bridge forwards from a decoded EVENT frame. */
export interface RawEvent {
  id: number;
  logLevels: number;
  arguments: Uint8Array;
  eventTimeBootMs: number;
}

interface Px4EventsState {
  metadata: Map<number, EventMeta>;
  metadataLoaded: boolean;
  events: DecodedEvent[];
  /** Set the metadata for the selected drone (FC-served, or bundled in demo). */
  setMetadata: (metadata: Map<number, EventMeta>) => void;
  /** Resolve + render a raw event and append it (bounded). */
  pushRaw: (raw: RawEvent) => void;
  clear: () => void;
}

let keyCounter = 0;

export const usePx4EventsStore = create<Px4EventsState>((set, get) => ({
  metadata: new Map(),
  metadataLoaded: false,
  events: [],

  setMetadata: (metadata) => set({ metadata, metadataLoaded: true }),

  pushRaw: (raw) => {
    const meta = get().metadata.get(raw.id);
    const text = meta
      ? renderEventMessage(meta.message, raw.arguments, meta.args, meta.enums)
      : `Unknown event ${raw.id}`;
    const decoded: DecodedEvent = {
      key: keyCounter++,
      id: raw.id,
      name: meta?.name ?? `event_${raw.id}`,
      text,
      severity: raw.logLevels & 0x0f,
      timeBootMs: raw.eventTimeBootMs,
      receivedAt: Date.now(),
    };
    set((s) => {
      const next = [...s.events, decoded];
      return { events: next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next };
    });
  },

  clear: () => set({ events: [], metadata: new Map(), metadataLoaded: false }),
}));
