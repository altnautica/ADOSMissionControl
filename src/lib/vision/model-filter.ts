/**
 * @module vision/model-filter
 * @description Pure board-fit filter for the vision model picker. Merges the
 * registry, the installed files, and the operator-uploaded custom models into
 * one list, tags each entry with whether it fits the node's compute (NPU
 * runtime / TOPS / SoC), and reports WHY an entry is a poor fit so the picker
 * can badge it instead of silently hiding it.
 *
 * The fit rule is deliberately permissive: a model is "fit" unless we have a
 * positive reason it won't run here. We never hide a model the operator could
 * still try; we only down-rank and explain. A CPU-only board (no NPU) keeps the
 * ONNX/CPU and small-input variants and flags the ones that demand an NPU
 * runtime or more TOPS than the board has.
 *
 * @license GPL-3.0-only
 */

import type {
  VisionCustomModel,
  VisionInstalledModel,
  VisionModelsResponse,
  VisionRegistryModel,
} from "@/lib/agent/vision-client";

/** The compute facts the filter reasons over, read from the capabilities +
 * system stores by the caller. All optional — a missing fact means "unknown",
 * which the filter treats as permissive (don't penalize on what we can't see). */
export interface BoardComputeFacts {
  /** Declared/probed SoC string (e.g. "RK3588S2", "BCM2711"). */
  soc?: string | null;
  /** HAL board id the agent reports (e.g. "rpi4b", "rock-5c-lite"). The
   * primary key board-match constraints carry. */
  boardId?: string | null;
  /** Human board name (e.g. "Raspberry Pi 4B"). A secondary match target. */
  boardName?: string | null;
  /** CPU architecture (e.g. "aarch64"/"arm64"). Lets a `generic-arm64`
   * board-match constraint fit any arm64 node. */
  arch?: string | null;
  /** The board's NPU runtime, or null on a CPU-only board. */
  npuRuntime?: "rknn" | "tensorrt" | "tflite" | "opencv_dnn" | null;
  /** The board's NPU compute in TOPS (0 on a CPU-only board). */
  npuTops?: number;
}

/** Why a model is a poor fit for this board, or null when it fits. */
export type ModelFitReason =
  | null
  | "needs_npu"
  | "runtime_mismatch"
  | "insufficient_tops"
  | "board_mismatch";

/** Where a model entry came from in the merged list. */
export type ModelSource = "registry" | "installed" | "custom";

/** One merged, board-tagged model row the picker renders. */
export interface FilteredModel {
  /** Stable model id (dedup key across sources). */
  id: string;
  /** Display name (falls back to id). */
  name: string;
  /** Short description, when the source has one. */
  description: string;
  /** Output task ("detection" | "tracking" | "depth" | …), best-effort. */
  task: string;
  /** Every source this id appears in (a registry model can also be installed). */
  sources: ModelSource[];
  /** True when the model already has a file on the agent (installed/custom). */
  installed: boolean;
  /** True when this is an operator-uploaded custom model. */
  custom: boolean;
  /** True when the model is the engine's currently-active detector. */
  active: boolean;
  /** True when the model is a good fit for this board. */
  fits: boolean;
  /** Why it does not fit (null when it fits). */
  fitReason: ModelFitReason;
  /** The custom-model metadata when this row is custom; null otherwise. */
  customMeta: VisionCustomModel | null;
  /** True when the registry marks the model for benchmarks and explicit
   * installs only (its weights carry research-use terms); never a default. */
  benchmarkOnly: boolean;
}

/** Pull a `min_tops` number out of a registry variant's opaque descriptor. */
function variantMinTops(variant: Record<string, unknown>): number | null {
  const v = variant.min_tops ?? variant.minTops;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Pull a runtime string out of a registry variant's opaque descriptor. */
function variantRuntime(variant: Record<string, unknown>): string | null {
  const v = variant.runtime ?? variant.format;
  return typeof v === "string" ? v : null;
}

/** Pull the board-match list out of a registry variant's opaque descriptor.
 * Accepts both shapes the catalog uses: a list (`["rpi4b", "generic-arm64"]`)
 * and a single bare string (`"rk3588"`). A non-string/empty value means "no
 * constraint" (fits everywhere). */
function variantBoardMatch(variant: Record<string, unknown>): string[] {
  const v = variant.board_match ?? variant.boardMatch;
  if (typeof v === "string") return v.length > 0 ? [v] : [];
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is string => typeof e === "string");
}

/** Does a model that requires `runtime` run on a node with `npuRuntime`? A
 * CPU runtime ("onnx"/"opencv_dnn"/"tflite-cpu") runs anywhere; an NPU runtime
 * needs the matching NPU. Unknown facts are permissive. */
function runtimeFits(
  runtime: string | null,
  facts: BoardComputeFacts,
): ModelFitReason {
  if (!runtime) return null;
  const r = runtime.toLowerCase();
  // CPU-class runtimes run on any board.
  if (r === "onnx" || r === "opencv_dnn" || r === "tflite" || r === "cpu") {
    return null;
  }
  // NPU-class runtimes ("rknn", "tensorrt").
  const hasNpu =
    facts.npuRuntime != null && facts.npuRuntime !== "opencv_dnn";
  if (!hasNpu) {
    // We know there is no NPU only when npuRuntime was reported as null AND
    // tops is reported as 0. Otherwise stay permissive.
    if (facts.npuRuntime === null) return "needs_npu";
    return null;
  }
  if (r === "rknn" && facts.npuRuntime !== "rknn") return "runtime_mismatch";
  if (r === "tensorrt" && facts.npuRuntime !== "tensorrt") {
    return "runtime_mismatch";
  }
  return null;
}

/** Is `arch` an arm64 / aarch64 architecture? */
function isArm64(arch: string | null | undefined): boolean {
  const a = (arch ?? "").toLowerCase();
  return a.includes("aarch64") || a.includes("arm64");
}

/** Does the board satisfy a model's board-match constraint? Empty constraint
 * = fits everywhere. `board_match` carries HAL board ids ("rpi4b") and family
 * aliases ("generic-arm64"). We match against the board id, the human name,
 * and the SoC string (substring either way, case-insensitive); a
 * `generic-arm64` / `generic` token fits any arm64 board. Unknown board facts
 * stay permissive. */
function boardMatchFits(
  boardMatch: string[],
  facts: BoardComputeFacts,
): boolean {
  if (boardMatch.length === 0) return true;

  const targets = [
    (facts.boardId ?? "").toLowerCase(),
    (facts.boardName ?? "").toLowerCase(),
    (facts.soc ?? "").toLowerCase(),
  ].filter((t) => t.length > 0);

  // No identifying board facts at all — stay permissive.
  if (targets.length === 0) return true;

  return boardMatch.some((m) => {
    const needle = m.toLowerCase();
    // Family alias: a generic-arm64 model fits any arm64 board.
    if (
      (needle === "generic-arm64" || needle === "generic" || needle === "arm64") &&
      isArm64(facts.arch)
    ) {
      return true;
    }
    return targets.some((t) => t.includes(needle) || needle.includes(t));
  });
}

/** Best-fit across a registry model's variants: if ANY variant fits the board,
 * the model fits; otherwise report the least-bad reason. */
function registryFit(
  model: VisionRegistryModel,
  facts: BoardComputeFacts,
): ModelFitReason {
  if (model.variants.length === 0) return null;
  let firstReason: ModelFitReason = null;
  for (const variant of model.variants) {
    const minTops = variantMinTops(variant);
    const runtime = variantRuntime(variant);
    const boards = variantBoardMatch(variant);

    if (!boardMatchFits(boards, facts)) {
      firstReason = firstReason ?? "board_mismatch";
      continue;
    }
    const rtReason = runtimeFits(runtime, facts);
    if (rtReason) {
      firstReason = firstReason ?? rtReason;
      continue;
    }
    if (
      minTops != null &&
      minTops > 0 &&
      typeof facts.npuTops === "number" &&
      facts.npuTops > 0 &&
      facts.npuTops < minTops
    ) {
      firstReason = firstReason ?? "insufficient_tops";
      continue;
    }
    // This variant fits → the model fits.
    return null;
  }
  return firstReason;
}

/** Fit of an operator-uploaded custom model against the board. */
function customFit(
  model: VisionCustomModel,
  facts: BoardComputeFacts,
): ModelFitReason {
  if (!boardMatchFits(model.boardMatch, facts)) return "board_mismatch";
  return runtimeFits(model.runtime, facts);
}

/** A merged, deduped, board-tagged model list for the picker. Registry models
 * come first (downloadable catalog), then installed-only files (sideloaded or
 * orphaned), then custom uploads. Within each source the input order is kept.
 * The `active` model is flagged but not reordered. */
export function filterModelsForBoard(
  models: VisionModelsResponse,
  facts: BoardComputeFacts,
): FilteredModel[] {
  const installedById = new Map<string, VisionInstalledModel>();
  for (const m of models.installed) installedById.set(m.id, m);
  const customById = new Map<string, VisionCustomModel>();
  for (const m of models.custom) customById.set(m.id, m);

  const out: FilteredModel[] = [];
  const seen = new Set<string>();
  const active = models.active;

  // 1. Registry models (the downloadable catalog).
  for (const m of models.registry) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const reason = registryFit(m, facts);
    const isCustom = customById.has(m.id);
    out.push({
      id: m.id,
      name: m.name || m.id,
      description: m.description,
      task: m.task,
      sources: isCustom ? ["registry", "custom"] : ["registry"],
      installed: installedById.has(m.id) || isCustom,
      custom: isCustom,
      active: active === m.id,
      fits: reason === null,
      fitReason: reason,
      customMeta: customById.get(m.id) ?? null,
      benchmarkOnly: m.benchmarkOnly === true,
    });
  }

  // 2. Installed-only files not in the registry and not custom.
  for (const m of models.installed) {
    if (!m.id || seen.has(m.id) || customById.has(m.id)) continue;
    seen.add(m.id);
    out.push({
      id: m.id,
      name: m.id,
      description: "",
      task: "",
      sources: ["installed"],
      installed: true,
      custom: false,
      active: active === m.id,
      fits: true,
      fitReason: null,
      customMeta: null,
      benchmarkOnly: false,
    });
  }

  // 3. Custom uploads not already merged into a registry row.
  for (const m of models.custom) {
    if (!m.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const reason = customFit(m, facts);
    out.push({
      id: m.id,
      name: m.name || m.id,
      description: "",
      task: "detection",
      sources: ["custom"],
      installed: true,
      custom: true,
      active: active === m.id,
      fits: reason === null,
      fitReason: reason,
      customMeta: m,
      benchmarkOnly: false,
    });
  }

  return out;
}
