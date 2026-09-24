/**
 * @module GeozonePanel
 * @description iNav geozone editor.
 * Reads up to 15 geozones (with polygon or circular shapes and vertices) from
 * the FC, allows in-place editing, and writes all data back via the protocol.
 * Per-zone editor lives in GeozoneZoneEditor; this file orchestrates load/save
 * and the zone list.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useGeozoneStore, GEOZONE_MAX } from "@/stores/geozone-store";
import { useArmedLock } from "@/hooks/use-armed-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { PanelHeader } from "../shared/PanelHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { GeozoneZoneEditor } from "./GeozoneZoneEditor";
import { MapPin, Plus, Upload } from "lucide-react";

export function GeozonePanel() {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const { toast } = useToast();
  const [mapEditZoneId, setMapEditZoneId] = useState<number | null>(null);

  const zones = useGeozoneStore((s) => s.zones);
  const vertices = useGeozoneStore((s) => s.vertices);
  const loading = useGeozoneStore((s) => s.loading);
  const error = useGeozoneStore((s) => s.error);
  const dirty = useGeozoneStore((s) => s.dirty);
  const activeId = useGeozoneStore((s) => s.activeId);
  const addZone = useGeozoneStore((s) => s.addZone);
  const setActiveId = useGeozoneStore((s) => s.setActiveId);
  const loadFromFc = useGeozoneStore((s) => s.loadFromFc);
  const uploadToFc = useGeozoneStore((s) => s.uploadToFc);

  const { isArmed, lockMessage } = useArmedLock();
  useUnsavedGuard(dirty);

  const hasLoaded = useGeozoneStore((s) => s.loaded);
  const connected = !!selectedProtocol;

  const handleRead = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await loadFromFc(protocol);
    const err = useGeozoneStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Geozones loaded from FC", "success");
    }
  }, [selectedProtocol, loadFromFc, toast]);

  const handleWrite = useCallback(async () => {
    const protocol = selectedProtocol;
    if (!protocol) {
      toast("Not connected to flight controller", "error");
      return;
    }
    await uploadToFc(protocol);
    const err = useGeozoneStore.getState().error;
    if (err) {
      toast(err, "error");
    } else {
      toast("Geozones written to FC", "success");
    }
  }, [selectedProtocol, uploadToFc, toast]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl space-y-4">
        <PanelHeader
          title="Geozones"
          subtitle="iNav polygon and circular no-fly or stay-inside zones"
          icon={<MapPin size={16} />}
          loading={loading}
          loadProgress={null}
          hasLoaded={hasLoaded}
          onRead={handleRead}
          connected={connected}
          error={error}
        >
          <div className="flex items-center gap-2">
            {zones.length < GEOZONE_MAX && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={12} />}
                disabled={!connected}
                onClick={() => addZone()}
              >
                Add zone
              </Button>
            )}
            {hasLoaded && (
              <Button
                variant="primary"
                size="sm"
                icon={<Upload size={12} />}
                loading={loading}
                disabled={!connected || loading || isArmed}
                title={isArmed ? lockMessage : undefined}
                onClick={handleWrite}
              >
                Write to FC
              </Button>
            )}
          </div>
        </PanelHeader>

        {dirty && (
          <p className="text-[10px] font-mono text-status-warning">
            Unsaved changes : use Write to FC to persist.
          </p>
        )}

        {zones.length === 0 && hasLoaded === false && (
          <p className="text-xs text-text-tertiary">
            Read from FC to load existing zones, or add a new zone above.
          </p>
        )}

        {zones.map((zone) => {
          const isActive = activeId === zone.number;
          const zoneVerts = vertices.get(zone.number) ?? [];
          return (
            <GeozoneZoneEditor
              key={zone.number}
              zone={zone}
              zoneVerts={zoneVerts}
              isActive={isActive}
              mapEditZoneId={mapEditZoneId}
              onToggleActive={() => setActiveId(isActive ? null : zone.number)}
              onSetMapEditZoneId={setMapEditZoneId}
            />
          );
        })}
      </div>
    </div>
  );
}
