/**
 * @module community-api-logd
 * @description Typed Convex API references for the explicitly-exported
 * durable-log windows surfaced in the ADOS Black Box view. Reads are
 * owner-gated server-side and degrade to an empty list when the account has
 * no exported windows.
 * @license GPL-3.0-only
 */

import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";

/** Newest-first list of exported windows for one device, owner-gated. */
export const getLogdWindowsRef = api.cmdLogdWindows.getLogdWindows;

/** Signed, time-limited download URL for one exported window, owner-gated. */
export const getLogdWindowRef = api.cmdLogdWindows.getLogdWindow;

/** One exported window record, as the list query returns it (no storage
 * handle, no owner). */
export type LogdWindow = FunctionReturnType<typeof getLogdWindowsRef>[number];
