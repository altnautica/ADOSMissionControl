"use client";

/**
 * Notes tab — editable customName, tags, markdown notes, favorite toggle.
 * Debounced 600 ms autosave to history-store + IDB.
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

function NotesTabInner({ record }: NotesTabProps) {
  const [customName, setCustomName] = useState(record.customName ?? "");
  const [notes, setNotes] = useState(record.notes ?? "");
  const [tagsText, setTagsText] = useState((record.tags ?? []).join(", "));
  const [favorite, setFavorite] = useState(record.favorite ?? false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const sealed = !!record.pilotSignatureHash;

  // Debounced save effect — skipped while sealed.
  useEffect(() => {
    if (sealed) return;
    const handle = setTimeout(() => {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const store = useHistoryStore.getState();
      store.updateRecord(record.id, {
        customName: customName || undefined,
        notes: notes || undefined,
        tags: tags.length > 0 ? tags : undefined,
        favorite,
      });
      void store.persistToIDB();
      setSavedAt(Date.now());
    }, SAVE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [record.id, customName, notes, tagsText, favorite, sealed]);

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
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Field A — North survey"
            disabled={sealed}
          />
          <Input
            label="Tags (comma separated)"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="survey, field-a, test"
            disabled={sealed}
          />
          <div className="flex items-center gap-2 mt-1">
            <Button
              variant={favorite ? "primary" : "secondary"}
              size="sm"
              icon={favorite ? <Star size={12} /> : <X size={12} />}
              onClick={() => setFavorite((f) => !f)}
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
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add observations, incidents, or context for this flight…"
          rows={8}
          disabled={sealed}
          className="w-full bg-bg-tertiary border border-border-default text-xs text-text-primary p-2 font-mono resize-y focus:outline-none focus:border-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="mt-1 text-[10px] text-text-tertiary">
          {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : "Unsaved"}
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
