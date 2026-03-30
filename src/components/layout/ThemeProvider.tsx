"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((s) => s.themeMode);

  useEffect(() => {
    // Apply theme to html element
    const htmlElement = document.documentElement;
    htmlElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  return <>{children}</>;
}
