/**
 * @module map/CustomTileSourceEditor
 * @description Editor for the operator-supplied ("custom") basemap: tile URL
 * template, max zoom and attribution, plus a live load/error readout so a
 * broken self-hosted URL is diagnosable instead of a silent grey map. Drafts
 * are held locally and committed on Apply — writing per keystroke would tear
 * down and rebuild the Leaflet tile layer on every character. Imports no
 * Leaflet, so the settings page can mount it directly.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_CUSTOM_TILE_MAX_ZOOM,
  MIN_CUSTOM_TILE_MAX_ZOOM,
  clampTileZoom,
  validateTileUrlTemplate,
} from "@/lib/tile-math";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useTileHealthStore } from "@/stores/tile-health-store";

export function CustomTileSourceEditor({ className }: { className?: string }) {
  const source = useSettingsStore((s) => s.mapTileSource);
  const storedUrl = useSettingsStore((s) => s.customTileUrl);
  const storedMaxZoom = useSettingsStore((s) => s.customTileMaxZoom);
  const storedAttribution = useSettingsStore((s) => s.customTileAttribution);
  const setSource = useSettingsStore((s) => s.setMapTileSource);
  const setUrl = useSettingsStore((s) => s.setCustomTileUrl);
  const setMaxZoom = useSettingsStore((s) => s.setCustomTileMaxZoom);
  const setAttribution = useSettingsStore((s) => s.setCustomTileAttribution);

  const healthTemplate = useTileHealthStore((s) => s.template);
  const loaded = useTileHealthStore((s) => s.loaded);
  const errors = useTileHealthStore((s) => s.errors);
  const lastErrorUrl = useTileHealthStore((s) => s.lastErrorUrl);

  const [draftUrl, setDraftUrl] = useState(storedUrl);
  const [draftMaxZoom, setDraftMaxZoom] = useState(String(storedMaxZoom));
  const [draftAttribution, setDraftAttribution] = useState(storedAttribution);

  // The settings store rehydrates from IndexedDB after mount, so the first
  // render sees the empty defaults. Without this the editor showed a blank URL
  // for an operator who already had one configured. Re-syncing on a stored
  // change is safe: the only other writer is this component's own Apply, which
  // sets the store to what the drafts already hold.
  useEffect(() => {
    setDraftUrl(storedUrl);
    setDraftMaxZoom(String(storedMaxZoom));
    setDraftAttribution(storedAttribution);
  }, [storedUrl, storedMaxZoom, storedAttribution]);

  // Read the page protocol after mount: the editor is server-rendered on
  // /config/data, and reading window during render is a hydration mismatch.
  const [pageIsHttps, setPageIsHttps] = useState(false);
  useEffect(() => setPageIsHttps(window.location.protocol === "https:"), []);

  const urlError = validateTileUrlTemplate(draftUrl);
  const trimmed = draftUrl.trim();
  const blockedMixedContent =
    pageIsHttps &&
    /^http:\/\//i.test(trimmed) &&
    !/^http:\/\/(localhost|127\.|\[?::1\]?)/i.test(trimmed);
  const dirty =
    trimmed !== storedUrl ||
    clampTileZoom(Number(draftMaxZoom)) !== storedMaxZoom ||
    draftAttribution !== storedAttribution ||
    source !== "custom";

  const apply = useCallback(() => {
    setUrl(draftUrl);
    setMaxZoom(Number(draftMaxZoom));
    setAttribution(draftAttribution);
    setSource("custom");
  }, [draftUrl, draftMaxZoom, draftAttribution, setUrl, setMaxZoom, setAttribution, setSource]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Input
        label="Tile URL template"
        value={draftUrl}
        onChange={(e) => setDraftUrl(e.target.value)}
        error={urlError ?? undefined}
        placeholder="http://localhost:8080/tiles/{z}/{x}/{y}.png"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
      />
      <Input
        label="Max zoom"
        type="number"
        min={MIN_CUSTOM_TILE_MAX_ZOOM}
        max={MAX_CUSTOM_TILE_MAX_ZOOM}
        value={draftMaxZoom}
        onChange={(e) => setDraftMaxZoom(e.target.value)}
      />
      <Input
        label="Attribution (optional)"
        value={draftAttribution}
        onChange={(e) => setDraftAttribution(e.target.value)}
      />
      {/* A warning, not a validation error: http://localhost and http://127.*
          are potentially-trustworthy origins and load fine from an https page. */}
      {blockedMixedContent && (
        <span className="text-[10px] text-status-warning leading-snug">
          This page is served over HTTPS, so the browser blocks http:// tiles from a
          non-loopback host. Serve the tiles over https, or open Mission Control over http.
        </span>
      )}
      <Button
        variant="primary"
        size="sm"
        onClick={apply}
        disabled={urlError !== null || !dirty}
      >
        Use this map
      </Button>
      {/* Only meaningful while the counters describe the persisted template —
          on the settings page with no map mounted they would read as stale. */}
      {healthTemplate === storedUrl && storedUrl !== "" && loaded + errors > 0 && (
        <span
          className={cn(
            "text-[9px] font-mono",
            errors > 0 && loaded === 0 ? "text-status-error" : "text-text-tertiary",
          )}
        >
          {loaded} tiles loaded, {errors} failed
          {lastErrorUrl ? ` — last failure: ${lastErrorUrl}` : ""}
        </span>
      )}
      <p className="text-[9px] text-text-tertiary leading-snug">
        Placeholders: {"{z}"}/{"{x}"}/{"{y}"}, optional {"{s}"} (a/b/c) and {"{r}"} (@2x).
        Tile caching and offline download additionally need the server to send
        Access-Control-Allow-Origin.
      </p>
    </div>
  );
}
