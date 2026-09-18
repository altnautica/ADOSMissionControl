/**
 * Type definitions and constants for usePanelParams hook.
 *
 * @license GPL-3.0-only
 */

import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import type { FlashCommitOutcome } from "./use-flash-commit-toast";

export interface PanelParamEvent {
  type: "read" | "write" | "flash" | "error" | "info";
  message: string;
}

export interface PanelParamOptions {
  /** List of parameter names to load. Accepts readonly tuples (`as const` arrays) directly. */
  paramNames: readonly string[];
  /** Params that may not exist on all firmware. They fail silently when absent. */
  optionalParams?: readonly string[];
  /** Panel identifier for tracking */
  panelId: string;
  /** Whether to auto-load on mount (default: false) */
  autoLoad?: boolean;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Concurrent fetch batch size (default: 8) */
  batchSize?: number;
  /** Optional callback for logging parameter operations */
  onEvent?: (event: PanelParamEvent) => void;
  /** Optional param metadata map — used to detect rebootRequired params on write */
  metadata?: Map<string, ParamMetadata>;
}

export interface UndoEntry {
  name: string;
  previousValue: number;
}

export const MAX_UNDO_STACK = 50;

export interface PanelParamState {
  params: Map<string, number>;
  loading: boolean;
  error: string | null;
  /** Which params have been modified but not saved to RAM */
  dirtyParams: Set<string>;
  /** Whether any params have been written to RAM but not flashed */
  hasRamWrites: boolean;
  /** Progress of current load operation */
  loadProgress: { loaded: number; total: number } | null;
  /** Whether params have been loaded at least once */
  hasLoaded: boolean;
  /** Optional params that were not found on this firmware */
  missingOptional: Set<string>;
  /** Number of entries in the undo stack */
  undoCount: number;
  /** If loaded from IDB cache (offline), this is the cache timestamp */
  idbCacheTimestamp: number | null;
}

export interface PanelParamActions {
  /** Reload all params from FC */
  refresh: () => Promise<void>;
  /** Update a param value locally (marks as dirty) */
  setLocalValue: (name: string, value: number) => void;
  /** Write a single param to RAM on the FC */
  saveToRam: (name: string, value: number) => Promise<boolean>;
  /** Write all dirty params to RAM */
  saveAllToRam: () => Promise<boolean>;
  /** Commit all RAM writes to flash. Reports whether the command reached the
   *  vehicle AND whether the vehicle acknowledged it — a sent-but-unacked
   *  commit is not a confirmed write. */
  commitToFlash: () => Promise<FlashCommitOutcome>;
  /** Revert a param to its loaded value */
  revert: (name: string) => void;
  /** Revert all dirty params */
  revertAll: () => void;
  /** Undo the last param edit */
  undo: () => void;
}

export const RETRY_DELAYS = [500, 1000, 2000];
export const DEFAULT_BATCH_SIZE = 8;
export const EMPTY_ARRAY: string[] = [];
