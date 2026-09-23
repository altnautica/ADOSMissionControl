/**
 * @module use-synced-draft
 * @description Text draft for an editor field that follows its source value.
 * The draft holds whatever the operator is typing (a lone "-", an emptied
 * field) until it is committed, and snaps back to the source whenever the
 * source changes underneath it (undo/redo, a map drag, a store write), so a
 * later blur never writes a stale draft back. The source is passed already
 * formatted as the field shows it (`draftText` for a number).
 * @license GPL-3.0-only
 */

import { useState, type Dispatch, type SetStateAction } from "react";

/** Render an optional number the way a numeric field shows it. */
export function draftText(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) ? String(value) : "";
}

export function useSyncedDraft(text: string): [string, Dispatch<SetStateAction<string>>] {
  const [draft, setDraft] = useState(text);
  const [source, setSource] = useState(text);
  // Adjust state during render when the source changes: no stale frame and no
  // extra effect pass.
  if (source !== text) {
    setSource(text);
    setDraft(text);
  }
  return [draft, setDraft];
}
