"use client";

/**
 * AI-generated flight summary + suggested tag chips.
 *
 * @module components/history/detail/tabs/overview/SummaryCard
 */

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { useHistoryStore } from "@/stores/history-store";
import { summarizeFlight, suggestTags } from "@/lib/ai/flight-summarizer";
import { Wand2, Tag } from "lucide-react";
import type { FlightRecord } from "@/lib/types";

export function SummaryCard({ record }: { record: FlightRecord }) {
  const tq = useTranslations("history.summaryCard");
  const summary = summarizeFlight(record);
  const suggested = suggestTags(record);
  const existingTags = record.tags ?? [];
  const newTags = suggested.filter((t) => !existingTags.includes(t));

  const addTag = (tag: string) => {
    const store = useHistoryStore.getState();
    const current = store.records.find((r) => r.id === record.id)?.tags ?? [];
    if (current.includes(tag)) return;
    store.updateRecord(record.id, { tags: [...current, tag] });
    void store.persistToIDB();
  };

  return (
    <Card title={tq("summary")} padding={true}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-1.5">
          <Wand2 size={11} className="text-accent-primary shrink-0 mt-0.5" />
          <p className="text-[11px] text-text-primary leading-relaxed">{summary}</p>
        </div>
        {newTags.length > 0 && (
          <div className="flex flex-col gap-1 mt-1 border-t border-border-default pt-2">
            <div className="flex items-center gap-1 text-[10px] text-text-secondary">
              <Tag size={10} />
              {tq("suggestedTags")}
            </div>
            <div className="flex flex-wrap gap-1">
              {newTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => addTag(tag)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary hover:bg-accent-primary/20 hover:text-accent-primary transition-colors"
                >
                  + {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
