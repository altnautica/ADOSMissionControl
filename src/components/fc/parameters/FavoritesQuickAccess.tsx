"use client";

import { useTranslations } from "next-intl";
import { useState, useMemo } from "react";
import { ParameterGrid } from "./ParameterGrid";
import { ChevronDown, ChevronRight, Star } from "lucide-react";
import type { ParameterValue } from "@/lib/protocol/types";
import type { ParamMetadata } from "@/lib/protocol/param-metadata";
import type { ParamColumnVisibility } from "@/stores/settings-store";

export function FavoritesQuickAccess({
  parameters,
  favoriteParams,
  modified,
  onModify,
  metadata,
  columnVisibility,
}: {
  parameters: ParameterValue[];
  favoriteParams: string[];
  modified: Map<string, number>;
  onModify: (name: string, value: number) => void;
  metadata: Map<string, ParamMetadata>;
  columnVisibility: ParamColumnVisibility;
}) {
  const tk = useTranslations("fcPanels.favoritesQuickAccess");
  const [open, setOpen] = useState(true);
  const favSet = useMemo(() => new Set(favoriteParams), [favoriteParams]);
  const favParams = useMemo(
    () => parameters.filter((p) => favSet.has(p.name)),
    [parameters, favSet],
  );

  if (favParams.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-border-default bg-bg-secondary/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-tertiary transition-colors cursor-pointer"
      >
        {open ? <ChevronDown size={10} className="text-text-tertiary" /> : <ChevronRight size={10} className="text-text-tertiary" />}
        <Star size={10} className="text-status-warning" fill="currentColor" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
          {tk("favorites")}
        </span>
        <span className="text-[10px] text-text-tertiary font-mono">({favParams.length})</span>
      </button>
      {open && (
        <div className="max-h-[200px] overflow-auto">
          <ParameterGrid
            parameters={favParams}
            modified={modified}
            onModify={onModify}
            filter=""
            showModifiedOnly={false}
            metadata={metadata}
            columnVisibility={columnVisibility}
          />
        </div>
      )}
    </div>
  );
}
