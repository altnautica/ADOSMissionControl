"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { SelectOptionGroup } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ThemeMode, type AccentColor } from "@/stores/settings-store";

const ACCENT_COLORS = [
  { nameKey: "blue", value: "blue", swatchClass: "bg-[#3a82ff]" },
  { nameKey: "green", value: "green", swatchClass: "bg-[#22c55e]" },
  { nameKey: "amber", value: "amber", swatchClass: "bg-[#f59e0b]" },
  { nameKey: "red", value: "red", swatchClass: "bg-[#ef4444]" },
  { nameKey: "lime", value: "lime", swatchClass: "bg-[#84cc16]" },
  { nameKey: "purple", value: "purple", swatchClass: "bg-[#a855f7]" },
  { nameKey: "pink", value: "pink", swatchClass: "bg-[#ec4899]" },
  { nameKey: "cyan", value: "cyan", swatchClass: "bg-[#06b6d4]" },
  { nameKey: "orange", value: "orange", swatchClass: "bg-[#f97316]" },
] as const;

export function ThemeSection(): React.ReactNode {
  const t = useTranslations("settings.theme");
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const setAccentColor = useSettingsStore((s) => s.setAccentColor);

  const themeOptions: SelectOptionGroup[] = useMemo(() => [
    {
      label: t("groupCore"),
      options: [
        { value: "dark", label: t("dark") },
        { value: "light", label: t("light") },
      ],
    },
    {
      label: t("groupSolarized"),
      options: [
        { value: "solarized-dark", label: t("solarizedDark") },
        { value: "solarized-light", label: t("solarizedLight") },
      ],
    },
    {
      label: t("groupDarkThemes"),
      options: [
        { value: "dracula", label: t("dracula") },
        { value: "catppuccin-mocha", label: t("catppuccinMocha") },
        { value: "catppuccin-frappe", label: t("catppuccinFrappe") },
        { value: "nord", label: t("nord") },
        { value: "gruvbox-dark", label: t("gruvboxDark") },
        { value: "one-dark", label: t("oneDark") },
        { value: "tokyo-night", label: t("tokyoNight") },
        { value: "rose-pine", label: t("rosePine") },
        { value: "monokai", label: t("monokai") },
        { value: "kanagawa", label: t("kanagawa") },
        { value: "synthwave", label: t("synthwave") },
        { value: "github-dark", label: t("githubDark") },
      ],
    },
    {
      label: t("groupLightThemes"),
      options: [
        { value: "catppuccin-latte", label: t("catppuccinLatte") },
        { value: "gruvbox-light", label: t("gruvboxLight") },
      ],
    },
    {
      label: t("groupMidTone"),
      options: [
        { value: "ayu-dark", label: t("ayuDark") },
        { value: "ayu-mirage", label: t("ayuMirage") },
        { value: "everforest-dark", label: t("everforestDark") },
      ],
    },
  ], [t]);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <Select
            label={t("theme")}
            value={themeMode}
            onChange={(value) => setThemeMode(value as ThemeMode)}
            options={themeOptions}
            placeholder={t("selectTheme")}
            searchable
            maxHeight={480}
          />
        </div>
      </Card>

      <Card title={t("accentColor")}>
        <div className="flex flex-wrap gap-3">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => setAccentColor(color.value as AccentColor)}
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
              ACCENT_COLORS.find((c) => c.value === accentColor)?.nameKey ?? "blue",
            ),
          })}
        </p>
      </Card>
    </div>
  );
}
