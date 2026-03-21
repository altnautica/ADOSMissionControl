"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

const ACCENT_COLORS = [
  { nameKey: "blue", value: "#3a82ff" },
  { nameKey: "green", value: "#22c55e" },
  { nameKey: "amber", value: "#f59e0b" },
  { nameKey: "red", value: "#ef4444" },
  { nameKey: "lime", value: "#dff140" },
] as const;

export function ThemeSection() {
  const t = useTranslations("theme");
  const [darkMode, setDarkMode] = useState(true);
  const [selectedAccent, setSelectedAccent] = useState("#3a82ff");

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <Toggle
            label={t("darkMode")}
            checked={darkMode}
            onChange={setDarkMode}
          />
          <p className="text-[10px] text-text-tertiary">
            {t("lightModeSoon")}
          </p>
        </div>
      </Card>

      <Card title={t("accentColor")}>
        <div className="flex gap-3">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.value}
              onClick={() => setSelectedAccent(color.value)}
              className={cn(
                "w-8 h-8 border-2 transition-all cursor-pointer",
                selectedAccent === color.value
                  ? "border-text-primary scale-110"
                  : "border-transparent hover:border-border-default"
              )}
              style={{ backgroundColor: color.value }}
              title={t(color.nameKey)}
            />
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary mt-2">
          {t("selected", { name: t(ACCENT_COLORS.find((c) => c.value === selectedAccent)?.nameKey ?? "blue") })}
        </p>
      </Card>
    </div>
  );
}
