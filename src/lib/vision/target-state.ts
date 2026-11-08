/**
 * @module vision/target-state
 * @description The HUD target state resolver and its derived geometry. One
 * pure function decides, for the video of one camera, which detections and
 * follow-me phases are drawn, in which state, with which tags. Every video
 * surface (main video, PiP, node-detail previews) renders its result through
 * the same glyph, so a state looks the same everywhere.
 *
 * States are identified by shape and word; colour only reinforces them.
 *
 * @license GPL-3.0-only
 */

import type { FollowEvent, FollowState } from "@/lib/agent/nav-types";
import type { VisionDetection } from "@/stores/vision-detections-store";

import { HUD_COPY_EN, type HudCopy } from "./hud-copy";
import { classWord, formatRange, holdReasonWord, wrap180 } from "./target-format";

export type TargetKind =
  | "CANDIDATE"
  | "TRACKED"
  | "LOCKED"
  | "ACQUIRING"
  | "FOLLOWING"
  | "HOLDING"
  | "COASTING"
  | "SEARCHING"
  | "SEARCHING_OFFFRAME"
  | "LOST"
  | "GT";

/** Plate + text treatment of a tag. `*Filled` = solid plate, black text. */
export type TagTone =
  | "ink"
  | "primary"
  | "track"
  | "trackFilled"
  | "warnFilled"
  | "coast"
  | "crit"
  | "warn"
  | "muted"
  | "gt";

export interface DrawTag {
  text: string;
  tone: TagTone;
}

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawModifiers {
  uncertain: boolean;
  followStale: boolean;
  reacquired: boolean;
}

export interface DrawItem {
  kind: TargetKind;
  /** Stable React key (track identity where there is one). */
  key: string;
  trackId: number | null;
  /** Box in the result's frame pixels; null for the off-frame arrow. */
  rect: FrameRect | null;
  topTag: DrawTag | null;
  bottomTags: DrawTag[];
  modifiers: DrawModifiers;
  /** Centre reticle (FOLLOWING, HOLDING). */
  reticle: boolean;
  /** Feet tick at the box bottom-centre (FOLLOWING). */
  feetTick: boolean;
  /** Live confidence used for ordering. */
  confidence: number;
  /** The detection behind the item (absent for phase-driven items). */
  detection?: VisionDetection;
  /** Relative bearing (deg, clockwise from the camera axis) for
   * SEARCHING_OFFFRAME. */
  relBearingDeg?: number;
  /** Elapsed share of the 900 ms LOST fade, 0..1. */
  lostProgress?: number;
}

export interface ResolvedTargets {
  /** Frame size every `rect` is expressed in. */
  frameW: number;
  frameH: number;
  items: DrawItem[];
}

/** A detection batch reduced to what the resolver reads. */
export interface TargetBatch {
  cameraId: string;
  frameWidth: number;
  frameHeight: number;
  detections: VisionDetection[];
}

export interface DesignatedRef {
  cameraId: string;
  trackId: number | null;
  bbox: { x: number; y: number; width: number; height: number };
}

/** The last rect the followed track was drawn at, kept by the surface so a
 * LOST mark can fade at it. */
export interface LastFollowRect {
  trackId: number | null;
  rect: FrameRect;
  frameW: number;
  frameH: number;
  /** Clock (ms) when it was last drawn. */
  at: number;
}

export interface ResolveInput {
  /** The batch for the camera on this video (the caller matched it). */
  batch: TargetBatch | null;
  /** The camera this video shows. */
  cameraId: string;
  designated: DesignatedRef | null;
  follow: FollowState | null;
  /** Age (ms) of `follow`; ignored when `follow` is null. */
  followAgeMs: number;
  /** The latest discrete follow event and its age (ms). */
  event: { data: FollowEvent; ageMs: number } | null;
  nowMs: number;
  /** Video lost: no frame for > 1 s, or NO VIDEO / FROZEN. */
  videoLost?: boolean;
  lastFollowRect?: LastFollowRect | null;
  /** Vehicle yaw (deg, true north). */
  vehicleYawDeg?: number | null;
  /** Mount yaw of this camera (0 for front); null for a down-facing camera,
   * which never shows the off-frame arrow. */
  cameraYawOffsetDeg?: number | null;
  opts?: ResolveOptions;
}

export interface ResolveOptions {
  minCandidateConfidence?: number;
  /** World Engine ground-truth mode. */
  gt?: boolean;
  /** PiP surface: candidate tags hidden. */
  pip?: boolean;
  copy?: HudCopy;
}

export const FOLLOW_FRESH_MS = 2000;
export const LOST_FADE_MS = 900;
export const REACQUIRED_SNAP_MS = 320;
export const MAX_DRAW_ITEMS = 32;
export const MAX_CANDIDATE_TAGS = 8;
export const DEFAULT_MIN_CANDIDATE_CONFIDENCE = 0.45;

// ── resolver ─────────────────────────────────────────────────────────

const PRIORITY: Record<TargetKind, number> = {
  FOLLOWING: 0,
  HOLDING: 0,
  ACQUIRING: 0,
  LOCKED: 1,
  LOST: 1,
  COASTING: 2,
  SEARCHING: 2,
  SEARCHING_OFFFRAME: 2,
  TRACKED: 3,
  CANDIDATE: 4,
  GT: 4,
};

const NO_MODS: DrawModifiers = { uncertain: false, followStale: false, reacquired: false };

function pct(c: number): number {
  return Math.round(c * 100);
}

function rectOf(d: VisionDetection): FrameRect | null {
  return d.bbox ? { x: d.bbox.x, y: d.bbox.y, w: d.bbox.width, h: d.bbox.height } : null;
}

function isDesignatedItem(d: VisionDetection, cameraId: string, des: DesignatedRef | null): boolean {
  if (!des || des.cameraId !== cameraId || !d.bbox) return false;
  if (des.trackId != null) return d.trackId === des.trackId;
  return (
    d.trackId == null &&
    d.bbox.x === des.bbox.x &&
    d.bbox.y === des.bbox.y &&
    d.bbox.width === des.bbox.width &&
    d.bbox.height === des.bbox.height
  );
}

/**
 * Resolve the items to draw over one camera's video.
 */
export function resolveTargets(input: ResolveInput): ResolvedTargets {
  const { batch, cameraId, designated, follow, event, nowMs } = input;
  const o = input.opts ?? {};
  const copy = o.copy ?? HUD_COPY_EN;
  const minConf = o.minCandidateConfidence ?? DEFAULT_MIN_CANDIDATE_CONFIDENCE;
  const usableBatch = batch && batch.cameraId === cameraId ? batch : null;
  const frameW = usableBatch?.frameWidth ?? follow?.predictedBbox?.frameW ?? 0;
  const frameH = usableBatch?.frameHeight ?? follow?.predictedBbox?.frameH ?? 0;
  if (input.videoLost) return { frameW, frameH, items: [] };

  const followFresh = follow !== null && input.followAgeMs <= FOLLOW_FRESH_MS;
  const fresh = followFresh ? follow : null;
  const reacq =
    event && event.data.topic === "follow.reacquired" && event.ageMs <= REACQUIRED_SNAP_MS
      ? event.data
      : null;
  const lostEvent =
    event && event.data.topic === "follow.lost" && event.ageMs <= LOST_FADE_MS ? event.data : null;
  const showLost = (fresh?.phase === "lost" || lostEvent !== null) && input.lastFollowRect != null;
  const lostTrack = showLost ? input.lastFollowRect!.trackId : null;

  const rangeTags = (f: FollowState | null): DrawTag[] => {
    if (!f || f.rangeM === null) return [];
    const tags: DrawTag[] = [{ text: formatRange(f.rangeM), tone: "ink" }];
    if (f.rangeSigmaM !== null) {
      tags.push({ text: `±${(2 * f.rangeSigmaM).toFixed(1)} m`, tone: "muted" });
    }
    return tags;
  };
  const withQ = (tag: DrawTag, uncertain: boolean): DrawTag =>
    uncertain ? { ...tag, text: copy.uncertain(tag.text) } : tag;

  const items: DrawItem[] = [];

  for (let i = 0; i < (usableBatch?.detections.length ?? 0); i++) {
    const d = usableBatch!.detections[i];
    const rect = rectOf(d);
    if (!rect) continue;
    const key = d.trackId != null ? `t:${d.trackId}` : `i:${i}`;
    const cls = classWord(d.classLabel);
    const uncertain = d.lockState === "uncertain";
    const base = {
      key,
      trackId: d.trackId ?? null,
      rect,
      confidence: d.confidence,
      detection: d,
      reticle: false,
      feetTick: false,
    };
    const mods: DrawModifiers = {
      uncertain,
      followStale: false,
      reacquired: reacq !== null && d.trackId === reacq.trackId,
    };

    if (o.gt) {
      items.push({
        ...base,
        kind: "GT",
        topTag: { text: copy.gt(cls, d.trackId ?? i), tone: "gt" },
        bottomTags: [],
        modifiers: NO_MODS,
      });
      continue;
    }

    if (isDesignatedItem(d, cameraId, designated)) {
      if (showLost && d.trackId != null && d.trackId === lostTrack) continue;
      const phaseMatches = fresh !== null && fresh.trackId === d.trackId;
      if (phaseMatches && fresh.phase === "following") {
        items.push({
          ...base,
          kind: "FOLLOWING",
          topTag: withQ({ text: copy.track(pct(d.confidence)), tone: "trackFilled" }, uncertain),
          bottomTags: rangeTags(fresh),
          modifiers: mods,
          reticle: true,
          feetTick: true,
        });
        continue;
      }
      if (phaseMatches && fresh.phase === "acquiring") {
        items.push({
          ...base,
          kind: "ACQUIRING",
          topTag: withQ({ text: copy.acquiring(d.trackId ?? 0), tone: "track" }, uncertain),
          bottomTags: rangeTags(fresh),
          modifiers: mods,
        });
        continue;
      }
      if (phaseMatches && fresh.phase === "holding") {
        const reason = holdReasonWord(fresh.holdReason);
        items.push({
          ...base,
          kind: "HOLDING",
          topTag: withQ(
            { text: reason ? copy.hold(reason) : copy.holdBare(), tone: "warnFilled" },
            uncertain,
          ),
          bottomTags: rangeTags(fresh),
          modifiers: mods,
          reticle: true,
        });
        continue;
      }
      const stale = follow !== null && !followFresh;
      const bottom: DrawTag[] = stale
        ? [{ text: copy.followStale(), tone: "warn" }]
        : fresh && fresh.rangeM !== null && fresh.trackId === d.trackId
          ? [{ text: formatRange(fresh.rangeM), tone: "ink" }]
          : [];
      items.push({
        ...base,
        kind: "LOCKED",
        topTag: withQ(
          { text: copy.lock(d.trackId ?? 0, pct(d.confidence)), tone: "track" },
          uncertain,
        ),
        bottomTags: bottom,
        modifiers: { ...mods, followStale: stale },
      });
      continue;
    }

    if (d.trackId != null) {
      if (d.lockState === "lost") continue;
      items.push({
        ...base,
        kind: "TRACKED",
        topTag: withQ({ text: copy.tracked(cls, d.trackId), tone: "primary" }, uncertain),
        bottomTags: [],
        modifiers: mods,
      });
      continue;
    }

    if (d.confidence >= minConf) {
      items.push({
        ...base,
        kind: "CANDIDATE",
        topTag: o.pip ? null : { text: copy.candidate(cls, pct(d.confidence)), tone: "ink" },
        bottomTags: [],
        modifiers: NO_MODS,
      });
    }
  }

  // Phase-driven items (no detection box needed).
  if (fresh && !o.gt) {
    const pb = fresh.predictedBbox;
    const scaleRect = (p: NonNullable<typeof pb>): FrameRect => {
      const sx = frameW > 0 && p.frameW > 0 ? frameW / p.frameW : 1;
      const sy = frameH > 0 && p.frameH > 0 ? frameH / p.frameH : 1;
      return { x: p.x * sx, y: p.y * sy, w: p.w * sx, h: p.h * sy };
    };
    if (fresh.phase === "coasting" && pb && pb.cameraId === cameraId) {
      items.push({
        kind: "COASTING",
        key: `coast:${fresh.trackId ?? "?"}`,
        trackId: fresh.trackId,
        rect: scaleRect(pb),
        topTag: { text: copy.coast((fresh.coastRemainingS ?? 0).toFixed(1)), tone: "coast" },
        bottomTags:
          fresh.rangeM !== null
            ? [{ text: copy.est(formatRange(fresh.rangeM).replace(/ m$/, "")), tone: "coast" }]
            : [],
        modifiers: NO_MODS,
        reticle: false,
        feetTick: false,
        confidence: fresh.confidence ?? 0,
      });
    } else if (fresh.phase === "searching") {
      if (pb && pb.cameraId === cameraId) {
        items.push({
          kind: "SEARCHING",
          key: `search:${fresh.trackId ?? "?"}`,
          trackId: fresh.trackId,
          rect: scaleRect(pb),
          topTag: { text: copy.searching(), tone: "coast" },
          bottomTags: [],
          modifiers: NO_MODS,
          reticle: false,
          feetTick: false,
          confidence: fresh.confidence ?? 0,
        });
      } else if (
        pb === null &&
        fresh.bearingDeg !== null &&
        input.vehicleYawDeg != null &&
        input.cameraYawOffsetDeg != null
      ) {
        const rel = wrap180(fresh.bearingDeg - (input.vehicleYawDeg + input.cameraYawOffsetDeg));
        const deg = String(Math.round(((fresh.bearingDeg % 360) + 360) % 360) % 360).padStart(3, "0");
        items.push({
          kind: "SEARCHING_OFFFRAME",
          key: `search-off:${fresh.trackId ?? "?"}`,
          trackId: fresh.trackId,
          rect: null,
          topTag: { text: copy.searchingBearing(deg), tone: "coast" },
          bottomTags: [],
          modifiers: NO_MODS,
          reticle: false,
          feetTick: false,
          confidence: fresh.confidence ?? 0,
          relBearingDeg: rel,
        });
      }
    }
  }

  if (showLost && !o.gt) {
    const last = input.lastFollowRect!;
    const age = nowMs - last.at;
    if (age >= 0 && age <= LOST_FADE_MS) {
      const sx = frameW > 0 && last.frameW > 0 ? frameW / last.frameW : 1;
      const sy = frameH > 0 && last.frameH > 0 ? frameH / last.frameH : 1;
      items.push({
        kind: "LOST",
        key: `lost:${last.trackId ?? "?"}`,
        trackId: last.trackId,
        rect: { x: last.rect.x * sx, y: last.rect.y * sy, w: last.rect.w * sx, h: last.rect.h * sy },
        topTag: { text: copy.lost(), tone: "crit" },
        bottomTags: [],
        modifiers: NO_MODS,
        reticle: false,
        feetTick: false,
        confidence: 1,
        lostProgress: age / LOST_FADE_MS,
      });
    }
  }

  items.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.confidence - a.confidence);
  const drawn = items.slice(0, MAX_DRAW_ITEMS);
  let candidateTags = 0;
  for (const it of drawn) {
    if (it.kind !== "CANDIDATE" || !it.topTag) continue;
    candidateTags++;
    if (candidateTags > MAX_CANDIDATE_TAGS) it.topTag = null;
  }
  return { frameW, frameH, items: drawn };
}

/** The followed item's rect, for the surface to keep as `lastFollowRect`. */
export function followedRect(resolved: ResolvedTargets): { trackId: number | null; rect: FrameRect } | null {
  for (const it of resolved.items) {
    if (
      (it.kind === "FOLLOWING" || it.kind === "HOLDING" || it.kind === "ACQUIRING" || it.kind === "LOCKED") &&
      it.rect
    ) {
      return { trackId: it.trackId, rect: it.rect };
    }
  }
  return null;
}
