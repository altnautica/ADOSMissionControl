"use client";

/**
 * Equipment registry editor — props / motors / ESCs / cameras / gimbals /
 * payloads / frames / RC transmitters.
 *
 * Mirrors the {@link BatteryRegistryEditor} shape with an extra type filter
 * dropdown so the operator can browse one category at a time.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Trash2, Archive, Wrench, AlertTriangle } from "lucide-react";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import type { EquipmentItem, EquipmentType } from "@/lib/types/operator";
import { isInspectionDue } from "@/lib/equipment-inspection";

const EQUIPMENT_TYPES: EquipmentType[] = [
  "prop_set",
  "motor_set",
  "esc_set",
  "camera",
  "gimbal",
  "payload",
  "frame",
  "rc_tx",
];

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `equip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type PendingAction = { kind: "delete" | "retire"; id: string };

export function EquipmentRegistryEditor() {
  const t = useTranslations("operatorRegistry.equipment");
  const itemsMap = useEquipmentRegistryStore((s) => s.items);
  const upsert = useEquipmentRegistryStore((s) => s.upsert);
  const update = useEquipmentRegistryStore((s) => s.update);
  const remove = useEquipmentRegistryStore((s) => s.remove);
  const retire = useEquipmentRegistryStore((s) => s.retire);
  const markInspected = useEquipmentRegistryStore((s) => s.markInspected);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [pending, setPending] = useState<PendingAction | null>(null);

  const typeOptions = EQUIPMENT_TYPES.map((value) => ({ value, label: t(`type.${value}`) }));
  const filterOptions = [{ value: "all", label: t("allTypes") }, ...typeOptions];

  const items = useMemo(() => {
    const all = Object.values(itemsMap);
    return all
      .filter((i) => (showRetired ? true : !i.retiredAt))
      .filter((i) => (typeFilter === "all" ? true : i.type === typeFilter))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.label.localeCompare(b.label);
      });
  }, [itemsMap, showRetired, typeFilter]);

  const totalCount = Object.values(itemsMap).filter((i) => !i.retiredAt).length;
  const selected = selectedId ? itemsMap[selectedId] : undefined;

  const handleAdd = () => {
    const id = genId();
    const fresh: EquipmentItem = {
      id,
      type: typeFilter === "all" ? "prop_set" : (typeFilter as EquipmentType),
      label: t("newLabel"),
      totalFlightHours: 0,
      totalFlights: 0,
    };
    upsert(fresh);
    setSelectedId(id);
  };

  const confirmPending = () => {
    const action = pending;
    setPending(null);
    if (!action) return;
    if (action.kind === "retire") {
      retire(action.id);
      return;
    }
    remove(action.id);
    if (selectedId === action.id) setSelectedId(null);
  };

  const handleInspected = (id: string) => {
    markInspected(id);
  };

  return (
    <Card title={t("title")} padding={true}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-[11px] text-text-secondary">
            {t("activeCount", { shown: items.length, count: totalCount })}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              label=""
              value={typeFilter}
              onChange={setTypeFilter}
              options={filterOptions}
            />
            <label className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
              />
              {t("showRetired")}
            </label>
            <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={handleAdd}>
              {t("add")}
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">{t("empty")}</p>
        ) : (
          <div className="border border-border-default rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">{t("colType")}</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">{t("colLabel")}</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">{t("colFitment")}</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">{t("colHours")}</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">{t("colFlights")}</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const due = isInspectionDue(i);
                  return (
                    <tr
                      key={i.id}
                      onClick={() => setSelectedId(i.id)}
                      className={`border-b border-border-default cursor-pointer hover:bg-bg-tertiary ${
                        selectedId === i.id ? "bg-accent-primary/10" : ""
                      } ${i.retiredAt ? "opacity-50" : ""}`}
                    >
                      <td className="px-2 py-1.5 text-text-secondary">{t(`typeShort.${i.type}`)}</td>
                      <td className="px-2 py-1.5 text-text-primary">
                        <span className="inline-flex items-center gap-1.5">
                          {i.label}
                          {due && (
                            <span title={t("inspectionDue")}>
                              <AlertTriangle size={10} className="text-status-warning" />
                            </span>
                          )}
                          {i.retiredAt && (
                            <span className="text-[9px] text-text-tertiary">{t("retiredTag")}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-text-tertiary truncate max-w-[120px]" title={i.fitment ?? ""}>
                        {i.fitment ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-text-primary font-mono tabular-nums">
                        {(i.totalFlightHours ?? 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-text-primary font-mono tabular-nums">
                        {i.totalFlights ?? 0}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {due && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInspected(i.id);
                              }}
                              className="text-text-tertiary hover:text-status-success transition-colors"
                              aria-label={t("markInspected")}
                              title={t("markInspected")}
                            >
                              <Wrench size={12} />
                            </button>
                          )}
                          {!i.retiredAt && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPending({ kind: "retire", id: i.id });
                              }}
                              className="text-text-tertiary hover:text-status-warning transition-colors"
                              aria-label={t("retire")}
                              title={t("retireItem")}
                            >
                              <Archive size={12} />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPending({ kind: "delete", id: i.id });
                            }}
                            className="text-text-tertiary hover:text-status-error transition-colors"
                            aria-label={t("delete")}
                            title={t("deleteItem")}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <div className="border-t border-border-default pt-3">
            <h4 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">{selected.label}</h4>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t("typeLabel")}
                value={selected.type}
                onChange={(v) => update(selected.id, { type: v as EquipmentType })}
                options={typeOptions}
              />
              <Input
                label={t("label")}
                value={selected.label}
                onChange={(e) => update(selected.id, { label: e.target.value })}
              />
              <Input
                label={t("manufacturer")}
                value={selected.manufacturer ?? ""}
                onChange={(e) => update(selected.id, { manufacturer: e.target.value })}
              />
              <Input
                label={t("model")}
                value={selected.model ?? ""}
                onChange={(e) => update(selected.id, { model: e.target.value })}
              />
              <Input
                label={t("serialNumber")}
                value={selected.serial ?? ""}
                onChange={(e) => update(selected.id, { serial: e.target.value })}
              />
              <Input
                label={t("fitment")}
                value={selected.fitment ?? ""}
                onChange={(e) => update(selected.id, { fitment: e.target.value })}
                placeholder={t("fitmentPlaceholder")}
              />
              <Input
                label={t("installDate")}
                type="date"
                value={selected.installDate ?? ""}
                onChange={(e) => update(selected.id, { installDate: e.target.value })}
              />
              <Input
                label={t("inspectEvery")}
                type="number"
                min={0}
                value={selected.inspectionIntervalHours?.toString() ?? ""}
                onChange={(e) =>
                  update(selected.id, {
                    inspectionIntervalHours: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="25"
              />
              <Input
                label={t("lastInspected")}
                type="date"
                value={selected.lastInspectedAt ?? ""}
                onChange={(e) => update(selected.id, { lastInspectedAt: e.target.value })}
              />
              <Input
                label={t("totalFlightHours")}
                type="number"
                step="0.01"
                value={selected.totalFlightHours?.toString() ?? "0"}
                onChange={(e) =>
                  update(selected.id, {
                    totalFlightHours: e.target.value ? Number(e.target.value) : 0,
                  })
                }
              />
              <Input
                label={t("totalFlights")}
                type="number"
                value={selected.totalFlights?.toString() ?? "0"}
                onChange={(e) =>
                  update(selected.id, {
                    totalFlights: e.target.value ? Number(e.target.value) : 0,
                  })
                }
              />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
        title={pending?.kind === "retire" ? t("retireTitle") : t("deleteTitle")}
        message={pending?.kind === "retire" ? t("retireMessage") : t("deleteMessage")}
        confirmLabel={pending?.kind === "retire" ? t("retire") : t("delete")}
        variant="danger"
      />
    </Card>
  );
}
