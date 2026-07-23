/**
 * Typed shapes for the ADOS Ground Agent REST surface.
 *
 * This file is a thin barrel. The per-domain types live under
 * `types/` (status, radio, network, peripherals, pairing, ui, pic, mesh).
 * Callers continue to import from `@/lib/api/ground-station/types`
 * unchanged.
 *
 * @module api/ground-station/types
 * @license GPL-3.0-only
 */

export * from "./types/status";
export * from "./types/radio";
export * from "./types/crsf";
export * from "./types/network";
export * from "./types/peripherals";
export * from "./types/pairing";
export * from "./types/ui";
export * from "./types/pic";
export * from "./types/mesh";
