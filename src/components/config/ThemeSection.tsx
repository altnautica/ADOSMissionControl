"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

const ACCENT_COLORS = [
  { nameKey: "blue", value: "blue", swatchClass: "bg-[#3a82ff]" },
  { nameKey: "green", value: "green", swatchClass: "bg-[#22c55e]" },
  { nameKey: "amber", value: "amber", swatchClass: "bg-[#f59e0b]" },
  { nameKey: "red", value: "red", swatchClass: "bg-[#ef4444]" },
  { nameKey: "lime", value: "lime", swatchClass: "bg-[#84cc16]" },
] as const;

export function ThemeSection() {
  const t = useTranslations("theme");
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);
  const darkMode = themeMode === "dark";

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <Toggle
            label={t("darkMode")}
            checked={darkMode}
            onChange={(checked) =>
              setThemeMode(checked ? "dark" : "light")
            }
          />
        </div>
      </Card>

      <Card title={t("accentColor")}>
        <div className="flex gap-3">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => setAccentColor(color.value)}
              className={cn(
                "w-8 h-8 border-2 transition-all cursor-pointer",
                color.swatchClass,
                accentColor === color.value
                  ? "border-text-primary scale-110"
                  : "border-transparent hover:border-border-default",
              )}
              title={t(color.nameKey)}
            />
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary mt-2">
          {t("selected", {
            name: t(
              ACCENT_COLORS.find((c) => c.value === accentColor)?.nameKey ??
              "blue",
            ),
          })}
        </p>
      </Card>
    </div>
  );
}
