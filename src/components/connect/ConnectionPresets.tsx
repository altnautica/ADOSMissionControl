"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Trash2, Usb, Wifi } from "lucide-react";
import {
  getPresets,
  deletePreset,
  type ConnectionPreset,
} from "@/lib/connection-presets";

export function ConnectionPresets({
  onApply,
}: {
  onApply: (preset: ConnectionPreset) => void;
}) {
  const t = useTranslations("connect");
  const [presets, setPresets] = useState<ConnectionPreset[]>([]);

  useEffect(() => {
    getPresets().then(setPresets);
  }, []);

  async function handleDelete(id: string) {
    await deletePreset(id);
    setPresets(await getPresets());
  }

  if (presets.length === 0) {
    return (
      <p className="text-[10px] text-text-tertiary py-2">
        {t("noPresets")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {presets.map((preset) => (
        <div
          key={preset.id}
          className="flex items-center justify-between gap-2 py-1.5 border-b border-border-default last:border-0"
        >
          <button
            onClick={() => onApply(preset)}
            className="flex items-center gap-2 min-w-0 text-left cursor-pointer hover:text-text-primary transition-colors"
          >
            <Star size={12} className="text-accent-secondary shrink-0" />
            {preset.type === "serial" ? (
              <Usb size={12} className="text-text-tertiary shrink-0" />
            ) : (
              <Wifi size={12} className="text-text-tertiary shrink-0" />
            )}
            <span className="text-xs text-text-primary truncate">
              {preset.name}
            </span>
            <Badge variant="neutral" size="sm">
              {preset.type === "serial"
                ? `${preset.config.baudRate}`
                : preset.config.url?.replace("ws://", "")}
            </Badge>
          </button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={10} />}
            onClick={() => handleDelete(preset.id)}
          />
        </div>
      ))}
    </div>
  );
}
