"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { SelectOptionGroup } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ThemeMode } from "@/stores/settings-store";
import { ACCENT_COLORS } from "@/components/onboarding/constants";

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
              onClick={() => setAccentColor(color.value)}
              className={cn(
                "w-8 h-8 border-2 transition-all cursor-pointer",
                accentColor === color.value
                  ? "border-text-primary scale-110"
                  : "border-transparent hover:border-border-default",
              )}
              // The swatch previews the accent itself, so it is the preset
              // hue, not the current theme's accent token.
              style={{ backgroundColor: color.hex }}
              title={t(color.value)}
            />
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary mt-2">
          {t("selected", {
            name: t(
              ACCENT_COLORS.find((c) => c.value === accentColor)?.value ?? "blue",
            ),
          })}
        </p>
      </Card>
    </div>
  );
}
