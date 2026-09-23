"use client";

/**
 * Notes tab — editable customName, tags, markdown notes, favorite toggle.
 * Debounced 600 ms autosave to history-store + IDB of the fields the
 * operator edited; opening the tab writes nothing.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Star, X } from "lucide-react";
import { useHistoryStore } from "@/stores/history-store";
import type { FlightRecord } from "@/lib/types";

interface NotesTabProps {
  record: FlightRecord;
}

const SAVE_DELAY_MS = 600;

type EditableField = "customName" | "notes" | "tags" | "favorite";

function NotesTabInner({ record }: NotesTabProps) {
  const [customName, setCustomName] = useState(record.customName ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [tagsText, setTagsText] = useState((record.tags ?? []).join(", "));
  const [favorite, setFavorite] = useState(record.favorite ?? false);
  const [dirty, setDirty] = useState<ReadonlySet<EditableField>>(() => new Set());
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const sealed = !!record.pilotSignatureHash;

  const markDirty = (field: EditableField) =>
    setDirty((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

  // Debounced save of the edited fields only — skipped while sealed, so
  // fields changed elsewhere (a tag added on Overview) are never reverted.
  useEffect(() => {
    if (sealed || dirty.size === 0) return;
    const handle = setTimeout(() => {
      const patch: Partial<FlightRecord> = {};
      if (dirty.has("customName")) patch.customName = customName || undefined;
      if (dirty.has("notes")) patch.notes = notes || undefined;
      if (dirty.has("tags")) {
        const tags = tagsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        patch.tags = tags.length > 0 ? tags : undefined;
      }
      if (dirty.has("favorite")) patch.favorite = favorite;
      const store = useHistoryStore.getState();
      store.updateRecord(record.id, patch);
      void store.persistToIDB();
      setDirty(new Set());
      setSavedAt(Date.now());
    }, SAVE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [record.id, customName, notes, tagsText, favorite, sealed, dirty]);

  return (
    <div className="flex flex-col gap-3">
      {sealed && (
        <div className="rounded border border-status-success bg-status-success/10 px-3 py-2 text-[10px] text-text-secondary">
          This record is sealed. Unseal from the panel header to edit the name, tags, or notes.
        </div>
      )}
      <Card title="Name & Tags" padding={true}>
        <div className="flex flex-col gap-2">
          <Input
            label="Custom name"
            value={customName}
            onChange={(e) => {
              setCustomName(e.target.value);
              markDirty("customName");
            }}
            placeholder="Field A — North survey"
            disabled={sealed}
          />
          <Input
            label="Tags (comma separated)"
            value={tagsText}
            onChange={(e) => {
              setTagsText(e.target.value);
              markDirty("tags");
            }}
            placeholder="survey, field-a, test"
            disabled={sealed}
          />
          <div className="flex items-center gap-2 mt-1">
            <Button
              variant={favorite ? "primary" : "secondary"}
              size="sm"
              icon={favorite ? <Star size={12} /> : <X size={12} />}
              onClick={() => {
                setFavorite((f) => !f);
                markDirty("favorite");
              }}
              disabled={sealed}
            >
              {favorite ? "Favorited" : "Not favorited"}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Notes (markdown)" padding={true}>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            markDirty("notes");
          }}
          placeholder="Add observations, incidents, or context for this flight…"
          rows={8}
          disabled={sealed}
          className="w-full bg-bg-tertiary border border-border-default text-xs text-text-primary p-2 font-mono resize-y focus:outline-none focus:border-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="mt-1 text-[10px] text-text-tertiary">
          {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : dirty.size > 0 ? "Unsaved" : ""}
        </div>
      </Card>
    </div>
  );
}

/**
 * Public NotesTab — keys on `record.id` so React unmounts/remounts the inner
 * editor when the user switches to a different flight, naturally resetting
 * all draft state without ref tricks.
 */
export function NotesTab(props: NotesTabProps) {
  return <NotesTabInner key={props.record.id} {...props} />;
}
