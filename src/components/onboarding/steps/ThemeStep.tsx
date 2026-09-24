"use client";

/**
 * @module ThemeStep
 * @description Theme picker with hero preview, mini-tile library, group
 * filter, and accent color dock. Theme order is held in parent state so
 * tapping a tile swaps it into the preview slot.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ThemeMode, AccentColor } from "@/stores/settings-store";
import {
  THEME_CARDS,
  ACCENT_COLORS,
  GROUP_TABS,
  ACCENT_BALL_SIZE,
  ACCENT_BALL_GAP,
  ACCENT_CAPSULE_PADDING,
  ACCENT_DOCK_MAX_SCALE,
  ACCENT_DOCK_RADIUS,
  PRIMARY_CTA_CLASS,
  type ThemeGroup,
  type ThemeCardData,
} from "../constants";
import { StepDots } from "../parts/StepDots";
import { ThemeMiniTile } from "../parts/ThemeMiniTile";
import { ThemeWorkspacePreview } from "../parts/ThemeWorkspacePreview";
import { BackButton } from "./BackButton";

interface Props {
  themeOrder: ThemeMode[];
  accentColor: AccentColor;
  onThemeTileClick: (value: ThemeMode) => void;
  onAccentChange: (color: AccentColor) => void;
  next: () => void;
  back: () => void;
  dotStep: number;
  totalSteps: number;
}

export function ThemeStep({
  themeOrder,
  accentColor,
  onThemeTileClick,
  onAccentChange,
  next,
  back,
  dotStep,
  totalSteps,
}: Props) {
  const tTheme = useTranslations("welcome.theme");
  const tCommon = useTranslations("common");

  const [hoveredAccentColor, setHoveredAccentColor] = useState<AccentColor | null>(null);
  const [accentPointerX, setAccentPointerX] = useState<number | null>(null);
  const [activeGroup, setActiveGroup] = useState<ThemeGroup | "all">("all");

  // Look up cards from the canonical THEME_CARDS table. Parent owns the order.
  const orderedThemes = themeOrder
    .map((value) => THEME_CARDS.find((theme) => theme.value === value))
    .filter((theme): theme is ThemeCardData => Boolean(theme));
  const previewTheme = orderedThemes[0] ?? THEME_CARDS[0];
  const selectableThemes = orderedThemes
    .slice(1)
    .filter((theme) => activeGroup === "all" || theme.group === activeGroup)
    .slice(0, 20);

  const accentFocusColor = hoveredAccentColor ?? accentColor;
  const accentFocusIndex = Math.max(
    0,
    ACCENT_COLORS.findIndex((color) => color.value === accentFocusColor),
  );
  const accentFocusHex = ACCENT_COLORS[accentFocusIndex]?.hex ?? ACCENT_COLORS[0].hex;
  const accentCapsuleBackground = `linear-gradient(135deg, ${previewTheme.colors.surface} 0%, ${previewTheme.colors.bg} 52%, ${accentFocusHex}24 100%)`;
  const accentCapsuleBorder = `${previewTheme.colors.border}`;
  const accentCapsuleShadow = `inset 0 1px 0 ${previewTheme.colors.text}12, inset 0 -1px 0 ${previewTheme.colors.bg}66, 0 12px 28px ${previewTheme.colors.bg}55`;

  const accentColorLabels: Record<AccentColor, string> = {
    blue: tTheme("accentColors.blue"),
    green: tTheme("accentColors.green"),
    amber: tTheme("accentColors.amber"),
    red: tTheme("accentColors.red"),
    lime: tTheme("accentColors.lime"),
    purple: tTheme("accentColors.purple"),
    pink: tTheme("accentColors.pink"),
    cyan: tTheme("accentColors.cyan"),
    orange: tTheme("accentColors.orange"),
  };

  const groupTabLabels: Record<ThemeGroup | "all", string> = {
    all: tTheme("groupTabs.all"),
    dark: tTheme("groupTabs.dark"),
    light: tTheme("groupTabs.light"),
    mid: tTheme("groupTabs.mid"),
  };

  const getAccentDockScale = (index: number, colorValue: AccentColor): number => {
    const selectedBoost = accentColor === colorValue ? 1.06 : 1;
    if (accentPointerX === null) return selectedBoost;

    const centerX = ACCENT_CAPSULE_PADDING + (ACCENT_BALL_SIZE / 2) + (index * (ACCENT_BALL_SIZE + ACCENT_BALL_GAP));
    const distance = Math.abs(accentPointerX - centerX);
    if (distance >= ACCENT_DOCK_RADIUS) return selectedBoost;

    const t = 1 - (distance / ACCENT_DOCK_RADIUS);
    const eased = t * t * (3 - (2 * t));
    const dockScale = 1 + (eased * (ACCENT_DOCK_MAX_SCALE - 1));
    return Math.max(selectedBoost, dockScale);
  };

  return (
    <>
      <BackButton onClick={back} />

      <div className="w-full max-w-4xl">
        <h2 className="text-xl font-display font-semibold text-text-primary mb-1 text-center">
          {tTheme("title")}
        </h2>
        <p className="text-xs text-text-tertiary mb-6 text-center">
          {tTheme("subtitle")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4 mb-6">
          <div className="rounded-xl border border-border-default bg-bg-secondary p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-[11px] uppercase tracking-widest text-text-tertiary">{tTheme("themeLibrary")}</p>
              <span className="text-[10px] text-text-tertiary">{tTheme("visibleCount", { count: selectableThemes.length })}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {GROUP_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveGroup(tab.key)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    activeGroup === tab.key
                      ? "bg-accent-primary text-accent-foreground"
                      : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {groupTabLabels[tab.key]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {selectableThemes.map((theme) => (
                <ThemeMiniTile
                  key={theme.value}
                  theme={theme}
                  onClick={() => onThemeTileClick(theme.value)}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border-default bg-bg-secondary p-3">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-[11px] uppercase tracking-widest text-text-tertiary">{tTheme("preview")}</p>
              <span className="text-xs font-medium text-text-primary">{previewTheme.label}</span>
            </div>
            <ThemeWorkspacePreview theme={previewTheme} />
            <p className="text-[11px] text-text-tertiary mt-2 text-center">{tTheme("tapToSwap")}</p>
          </div>
        </div>

        {/* Accent color */}
        <div className="border-t border-border-default pt-4 mb-6">
          <p className="text-sm text-text-primary font-medium mb-3 text-center">{tTheme("accentColor")}</p>
          <div className="flex justify-center">
            <div
              className="relative inline-flex items-center gap-2 rounded-full border border-border-default px-2 py-2 touch-none"
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setAccentPointerX(event.clientX - rect.left);
              }}
              onPointerLeave={() => {
                setHoveredAccentColor(null);
                setAccentPointerX(null);
              }}
              onPointerCancel={() => {
                setHoveredAccentColor(null);
                setAccentPointerX(null);
              }}
              style={{
                background: accentCapsuleBackground,
                borderColor: accentCapsuleBorder,
                boxShadow: accentCapsuleShadow,
              }}
            >
              {ACCENT_COLORS.map((color, index) => {
                const dockScale = getAccentDockScale(index, color.value);
                const lift = (dockScale - 1) * 10;
                return (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => onAccentChange(color.value)}
                    onPointerEnter={() => setHoveredAccentColor(color.value)}
                    title={accentColorLabels[color.value]}
                    aria-label={tTheme("setAccentColorAria", { color: accentColorLabels[color.value] })}
                    className="relative rounded-full transition-transform duration-200 ease-out focus-visible:outline-none"
                    style={{
                      width: ACCENT_BALL_SIZE,
                      height: ACCENT_BALL_SIZE,
                      transform: `translateY(${-lift}px) scale(${dockScale})`,
                      zIndex: Math.round(dockScale * 10),
                    }}
                  >
                    <span
                      className="block w-full h-full rounded-full border border-border-strong"
                      style={{
                        backgroundColor: color.hex,
                        boxShadow: accentColor === color.value
                          ? `0 0 0 2px var(--alt-bg-primary), 0 0 0 4px ${color.hex}55`
                          : `0 3px 10px ${color.hex}40`,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={next}
          className={`${PRIMARY_CTA_CLASS} block w-fit mx-auto`}
        >
          {tCommon("continue")} →
        </button>

        <StepDots step={dotStep} total={totalSteps} />
      </div>
    </>
  );
}

