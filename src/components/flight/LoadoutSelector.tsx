"use client";

/**
 * Pre-flight loadout selector — picks battery + props + motors + ESCs +
 * camera + gimbal + payload + frame + RC TX for the currently selected drone.
 *
 * Reads from {@link useBatteryRegistryStore} and
 * {@link useEquipmentRegistryStore}, writes to {@link useLoadoutStore}. The
 * flight lifecycle then freezes the loadout into the FlightRecord on arm
 * and rolls usage stats forward on disarm.
 *
 * Compact card with an inline edit modal — kept narrow so it doesn't crowd
 * the rest of the flight dashboard.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Backpack, X, Trash2 } from "lucide-react";
import { useDroneStore } from "@/stores/drone-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { useLoadoutStore } from "@/stores/loadout-store";
import type { LoadoutSnapshot, EquipmentType, BatteryPack, EquipmentItem } from "@/lib/types";

const NONE_OPTION = { value: "", label: "—" };

interface SingleSlotProps {
  label: string;
  type: EquipmentType;
  value: string | undefined;
  items: EquipmentItem[];
  onChange: (value: string | undefined) => void;
}

function SingleSlot({ label, value, items, onChange }: SingleSlotProps) {
  const options = useMemo(
    () => [NONE_OPTION, ...items.map((i) => ({ value: i.id, label: i.label }))],
    [items],
  );
  return (
    <Select
      label={label}
      value={value ?? ""}
      onChange={(v) => onChange(v || undefined)}
      options={options}
    />
  );
}

interface BatterySlotProps {
  selectedIds: string[];
  packs: BatteryPack[];
  onChange: (ids: string[]) => void;
  label: string;
}

function BatterySlot({ selectedIds, packs, onChange, label }: BatterySlotProps) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-text-secondary">{label}</label>
      <div className="border border-border-default rounded p-2 max-h-32 overflow-y-auto">
        {packs.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">
            Register a battery pack in Settings → Operator &amp; Aircraft.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {packs.map((pack) => (
              <label key={pack.id} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(pack.id)}
                  onChange={() => toggle(pack.id)}
                />
                <span className="text-text-primary">{pack.label}</span>
                <span className="text-[10px] text-text-tertiary font-mono">
                  · {(pack.cycleCount ?? 0)} cycles
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LoadoutSelector() {
  const t = useTranslations("history");
  const droneId = useDroneStore((s) => s.selectedId);

  // Pull and reactively subscribe to all stores.
  const loadoutMap = useLoadoutStore((s) => s.loadouts);
  const setLoadout = useLoadoutStore((s) => s.set);
  const clearLoadout = useLoadoutStore((s) => s.clear);
  const loadLoadouts = useLoadoutStore((s) => s.loadFromIDB);

  const batteries = useBatteryRegistryStore((s) => s.packs);
  const equipment = useEquipmentRegistryStore((s) => s.items);
  const loadBatteries = useBatteryRegistryStore((s) => s.loadFromIDB);
  const loadEquipment = useEquipmentRegistryStore((s) => s.loadFromIDB);

  useEffect(() => {
    void loadLoadouts();
    void loadBatteries();
    void loadEquipment();
  }, [loadLoadouts, loadBatteries, loadEquipment]);

  const [editing, setEditing] = useState(false);

  const current: LoadoutSnapshot | undefined = droneId ? loadoutMap[droneId] : undefined;

  const activeBatteries = useMemo(
    () =>
      Object.values(batteries)
        .filter((p) => !p.retiredAt)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [batteries],
  );

  const byType = (type: EquipmentType): EquipmentItem[] =>
    Object.values(equipment)
      .filter((i) => !i.retiredAt && i.type === type)
      .sort((a, b) => a.label.localeCompare(b.label));

  const itemLabel = (id?: string): string => {
    if (!id) return t("loadoutEmpty");
    return equipment[id]?.label ?? "?";
  };

  const batteryLabels = (ids?: string[]): string => {
    if (!ids || ids.length === 0) return t("loadoutEmpty");
    return ids.map((id) => batteries[id]?.label ?? "?").join(", ");
  };

  if (!droneId) {
    return null;
  }

  return (
    <Card title={t("loadout")} padding={true}>
      <div className="flex flex-col gap-2">
        {!current ? (
          <p className="text-[10px] text-text-tertiary">{t("loadoutNone")}</p>
        ) : (
          <div className="flex flex-col gap-1 text-[11px] text-text-secondary">
            <div className="flex justify-between gap-2">
              <span className="text-text-tertiary">{t("loadoutBatteries")}</span>
              <span className="text-text-primary text-right truncate max-w-[200px]">
                {batteryLabels(current.batteryIds)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-text-tertiary">{t("loadoutPropSet")}</span>
              <span className="text-text-primary text-right truncate max-w-[200px]">
                {itemLabel(current.propSetId)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-text-tertiary">{t("loadoutMotorSet")}</span>
              <span className="text-text-primary text-right truncate max-w-[200px]">
                {itemLabel(current.motorSetId)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-text-tertiary">{t("loadoutPayload")}</span>
              <span className="text-text-primary text-right truncate max-w-[200px]">
                {itemLabel(current.payloadId)}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 mt-1">
          <Button
            variant="secondary"
            size="sm"
            icon={<Backpack size={12} />}
            onClick={() => setEditing(true)}
          >
            {t("loadoutEdit")}
          </Button>
          {current && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={12} />}
              onClick={() => clearLoadout(droneId)}
              title={t("loadoutClear")}
            />
          )}
        </div>
      </div>

      {editing && (
        <LoadoutEditor
          droneId={droneId}
          current={current ?? {}}
          activeBatteries={activeBatteries}
          byType={byType}
          onSave={(next) => {
            setLoadout(droneId, next);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </Card>
  );
}

interface LoadoutEditorProps {
  droneId: string;
  current: LoadoutSnapshot;
  activeBatteries: BatteryPack[];
  byType: (type: EquipmentType) => EquipmentItem[];
  onSave: (next: LoadoutSnapshot) => void;
  onClose: () => void;
}

function LoadoutEditor({ current, activeBatteries, byType, onSave, onClose }: LoadoutEditorProps) {
  const t = useTranslations("history");
  const [draft, setDraft] = useState<LoadoutSnapshot>(current);

  // Esc closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[480px] max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-secondary z-10">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            {t("loadoutEdit")}
          </h3>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <BatterySlot
            label={t("loadoutBatteries")}
            packs={activeBatteries}
            selectedIds={draft.batteryIds ?? []}
            onChange={(ids) => setDraft((d) => ({ ...d, batteryIds: ids.length > 0 ? ids : undefined }))}
          />
          <SingleSlot
            label={t("loadoutPropSet")}
            type="prop_set"
            value={draft.propSetId}
            items={byType("prop_set")}
            onChange={(v) => setDraft((d) => ({ ...d, propSetId: v }))}
          />
          <SingleSlot
            label={t("loadoutMotorSet")}
            type="motor_set"
            value={draft.motorSetId}
            items={byType("motor_set")}
            onChange={(v) => setDraft((d) => ({ ...d, motorSetId: v }))}
          />
          <SingleSlot
            label={t("loadoutEscSet")}
            type="esc_set"
            value={draft.escSetId}
            items={byType("esc_set")}
            onChange={(v) => setDraft((d) => ({ ...d, escSetId: v }))}
          />
          <SingleSlot
            label={t("loadoutCamera")}
            type="camera"
            value={draft.cameraId}
            items={byType("camera")}
            onChange={(v) => setDraft((d) => ({ ...d, cameraId: v }))}
          />
          <SingleSlot
            label={t("loadoutGimbal")}
            type="gimbal"
            value={draft.gimbalId}
            items={byType("gimbal")}
            onChange={(v) => setDraft((d) => ({ ...d, gimbalId: v }))}
          />
          <SingleSlot
            label={t("loadoutPayload")}
            type="payload"
            value={draft.payloadId}
            items={byType("payload")}
            onChange={(v) => setDraft((d) => ({ ...d, payloadId: v }))}
          />
          <SingleSlot
            label={t("loadoutFrame")}
            type="frame"
            value={draft.frameId}
            items={byType("frame")}
            onChange={(v) => setDraft((d) => ({ ...d, frameId: v }))}
          />
          <SingleSlot
            label={t("loadoutRcTx")}
            type="rc_tx"
            value={draft.rcTxId}
            items={byType("rc_tx")}
            onChange={(v) => setDraft((d) => ({ ...d, rcTxId: v }))}
          />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("clear")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => onSave(draft)}>
              {t("loadoutSave")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
