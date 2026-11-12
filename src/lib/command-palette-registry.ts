/**
 * @module command-palette-registry
 * @description A tiny registry that lets a route (e.g. the mission planner)
 * contribute extra commands to the global command palette without the palette
 * having to import every route. A provider is registered on mount and returns
 * the commands appropriate for the current query and path; the palette merges
 * all registered providers with its own built-in actions at render time.
 *
 * Pure module: no React, no store access.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";

/** One command row rendered by the palette. */
export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  icon?: ReactNode;
  /** Second line under the label (for example a parameter's name and units). */
  detail?: string;
  action: () => void;
}

/** Context handed to each provider so it can filter by query/route. */
export interface PaletteContext {
  query: string;
  pathname: string;
}

export type PaletteCommandProvider = (ctx: PaletteContext) => PaletteCommand[];

const providers = new Set<PaletteCommandProvider>();

/**
 * Register a command provider. Returns an unregister function to call on
 * unmount so a route's commands disappear when the route is left.
 */
export function registerCommandProvider(provider: PaletteCommandProvider): () => void {
  providers.add(provider);
  return () => {
    providers.delete(provider);
  };
}

/** Collect the commands from every registered provider for the given context. */
export function getRegisteredCommands(ctx: PaletteContext): PaletteCommand[] {
  return [...providers].flatMap((provider) => provider(ctx));
}
