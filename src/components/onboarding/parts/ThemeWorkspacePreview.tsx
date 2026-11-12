/**
 * Mock Mission Control workspace shown as a live preview when picking a theme.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { ACCENT_COLORS, type ThemeCardData } from "../constants";

interface ThemeWorkspacePreviewProps {
  theme: ThemeCardData;
}

export function ThemeWorkspacePreview({ theme }: ThemeWorkspacePreviewProps) {
  const tk = useTranslations("onboarding.themeWorkspacePreview");
  const t = useTranslations("welcome.theme");
  const tNav = useTranslations("nav");
  const tStatus = useTranslations("status");
  const { colors, label } = theme;
  const accentColor = useSettingsStore((s) => s.accentColor);
  const accentHex = ACCENT_COLORS.find((c) => c.value === accentColor)?.hex ?? colors.accent;

  const navItems = [
    tNav("dashboard"),
    t("workspace.menu.flight"),
    tNav("plan"),
    tNav("configure"),
  ];

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
      aria-label={`${label} full preview`}
    >
      <div
        className="h-10 px-3 flex items-center gap-2"
        style={{
          backgroundColor: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accentHex }} />
        <span className="text-xs font-semibold" style={{ color: colors.text }}>{tk("missionControl")}</span>
        <span className="ml-auto text-[10px] opacity-70" style={{ color: colors.text }}>{tStatus("connected")}</span>
      </div>

      <div className="grid grid-cols-[88px_1fr] min-h-[220px]">
        <aside
          className="p-2.5 space-y-1.5"
          style={{
            backgroundColor: colors.surface,
            borderRight: `1px solid ${colors.border}`,
          }}
        >
          {navItems.map((item, idx) => (
            <div
              key={item}
              className="rounded px-2 py-1 text-[10px] truncate"
              style={{
                color: colors.text,
                backgroundColor: idx === 1 ? accentHex : `${colors.border}55`,
                opacity: idx === 1 ? 1 : 0.85,
              }}
            >
              {item}
            </div>
          ))}
        </aside>

        <main className="p-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold" style={{ color: colors.text }}>{t("workspace.flightOverview")}</h4>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{
                color: colors.bg,
                backgroundColor: accentHex,
              }}
            >
              {t("workspace.live")}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              [t("workspace.telemetry.alt"), "42m"],
              [t("workspace.telemetry.speed"), "11m/s"],
              ["RSSI", "97%"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="rounded p-2"
                style={{
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <p className="text-[9px] opacity-70" style={{ color: colors.text }}>{k}</p>
                <p className="text-[11px] font-semibold" style={{ color: colors.text }}>{v}</p>
              </div>
            ))}
          </div>

          <div
            className="rounded p-2.5 mb-3"
            style={{
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
            }}
          >
            <p className="text-[10px] mb-1" style={{ color: colors.text }}>{t("workspace.missionStatus")}</p>
            <p className="text-[9px] opacity-75" style={{ color: colors.text }}>
              {t("workspace.missionStatusSample")}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="h-7 px-2.5 rounded text-[10px] font-semibold"
              style={{
                backgroundColor: accentHex,
                color: colors.bg,
              }}
            >
              {t("workspace.armVehicle")}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className="h-7 px-2.5 rounded text-[10px]"
              style={{
                backgroundColor: colors.surface,
                color: colors.text,
                border: `1px solid ${colors.border}`,
              }}
            >
              {t("workspace.openPlanner")}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
