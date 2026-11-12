/**
 * The shell's top-level routes, shared by the top-bar nav and the compact
 * menu that replaces it on narrow screens.
 *
 * @license GPL-3.0-only
 */

import { LayoutDashboard, Route, Play, History, Bot } from "lucide-react";

// Agent management is unified into the Dashboard drone view; there is no
// separate Command tab. /command redirects to the Dashboard for old links.
export const SHELL_NAV_TABS = [
  { icon: LayoutDashboard, labelKey: "dashboard", href: "/" },
  { icon: Route, labelKey: "plan", href: "/plan" },
  { icon: Play, labelKey: "simulate", href: "/simulate" },
  { icon: History, labelKey: "history", href: "/flight-logs" },
  { icon: Bot, labelKey: "mcp", href: "/mcp" },
];
