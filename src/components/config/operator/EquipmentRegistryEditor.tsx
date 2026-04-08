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

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Archive, Wrench, AlertTriangle } from "lucide-react";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import type { EquipmentItem, EquipmentType } from "@/lib/types/operator";

const TYPE_OPTIONS: { value: EquipmentType; label: string }[] = [
  { value: "prop_set", label: "Propeller set" },
  { value: "motor_set", label: "Motor set" },
  { value: "esc_set", label: "ESC set" },
  { value: "camera", label: "Camera" },
  { value: "gimbal", label: "Gimbal" },
  { value: "payload", label: "Payload" },
  { value: "frame", label: "Frame" },
  { value: "rc_tx", label: "RC transmitter" },
];

const FILTER_OPTIONS = [
  { value: "all", label: "All types" },
  ...TYPE_OPTIONS,
];

const TYPE_LABEL: Record<EquipmentType, string> = {
  prop_set: "Props",
  motor_set: "Motors",
  esc_set: "ESCs",
  camera: "Camera",
  gimbal: "Gimbal",
  payload: "Payload",
  frame: "Frame",
  rc_tx: "RC TX",
};

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `equip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EquipmentRegistryEditor() {
  const itemsMap = useEquipmentRegistryStore((s) => s.items);
  const upsert = useEquipmentRegistryStore((s) => s.upsert);
  const update = useEquipmentRegistryStore((s) => s.update);
  const remove = useEquipmentRegistryStore((s) => s.remove);
  const retire = useEquipmentRegistryStore((s) => s.retire);
  const markInspected = useEquipmentRegistryStore((s) => s.markInspected);
  const loadFromIDB = useEquipmentRegistryStore((s) => s.loadFromIDB);

  useEffect(() => {
    void loadFromIDB();
  }, [loadFromIDB]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

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
      label: "New equipment",
      totalFlightHours: 0,
      totalFlights: 0,
    };
    upsert(fresh);
    setSelectedId(id);
  };

  const handleDelete = (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this equipment item permanently?")) return;
    remove(id);
    if (selectedId === id) setSelectedId(null);
  };

  const handleRetire = (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Retire this item? It will be hidden from active loadout pickers.")) return;
    retire(id);
  };

  const handleInspected = (id: string) => {
    markInspected(id);
  };

  return (
    <Card title="Equipment" padding={true}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-[11px] text-text-secondary">
            {items.length} of {totalCount} active item{totalCount === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              label=""
              value={typeFilter}
              onChange={setTypeFilter}
              options={FILTER_OPTIONS}
            />
            <label className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <input
                type="checkbox"
                checked={showRetired}
                onChange={(e) => setShowRetired(e.target.checked)}
              />
              Show retired
            </label>
            <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={handleAdd}>
              Add item
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">
            No equipment registered. Click Add to register a propeller set, motor, ESC, camera, gimbal, payload, frame, or RC transmitter.
          </p>
        ) : (
          <div className="border border-border-default rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Type</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Label</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Fitment</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">Hours</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">Flights</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const due =
                    i.inspectionDueHours !== undefined &&
                    (i.totalFlightHours ?? 0) >= i.inspectionDueHours;
                  return (
                    <tr
                      key={i.id}
                      onClick={() => setSelectedId(i.id)}
                      className={`border-b border-border-default cursor-pointer hover:bg-bg-tertiary ${
                        selectedId === i.id ? "bg-accent-primary/10" : ""
                      } ${i.retiredAt ? "opacity-50" : ""}`}
                    >
                      <td className="px-2 py-1.5 text-text-secondary">{TYPE_LABEL[i.type]}</td>
                      <td className="px-2 py-1.5 text-text-primary">
                        <span className="inline-flex items-center gap-1.5">
                          {i.label}
                          {due && (
                            <span title="Inspection due">
                              <AlertTriangle size={10} className="text-status-warning" />
                            </span>
                          )}
                          {i.retiredAt && (
                            <span className="text-[9px] text-text-tertiary">retired</span>
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
                              aria-label="Mark inspected"
                              title="Mark inspected"
                            >
                              <Wrench size={12} />
                            </button>
                          )}
                          {!i.retiredAt && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRetire(i.id);
                              }}
                              className="text-text-tertiary hover:text-status-warning transition-colors"
                              aria-label="Retire"
                              title="Retire item"
                            >
                              <Archive size={12} />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(i.id);
                            }}
                            className="text-text-tertiary hover:text-status-error transition-colors"
                            aria-label="Delete"
                            title="Delete item"
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
                label="Type"
                value={selected.type}
                onChange={(v) => update(selected.id, { type: v as EquipmentType })}
                options={TYPE_OPTIONS}
              />
              <Input
                label="Label"
                value={selected.label}
                onChange={(e) => update(selected.id, { label: e.target.value })}
              />
              <Input
                label="Manufacturer"
                value={selected.manufacturer ?? ""}
                onChange={(e) => update(selected.id, { manufacturer: e.target.value })}
              />
              <Input
                label="Model"
                value={selected.model ?? ""}
                onChange={(e) => update(selected.id, { model: e.target.value })}
              />
              <Input
                label="Serial number"
                value={selected.serial ?? ""}
                onChange={(e) => update(selected.id, { serial: e.target.value })}
              />
              <Input
                label="Fitment"
                value={selected.fitment ?? ""}
                onChange={(e) => update(selected.id, { fitment: e.target.value })}
                placeholder="Alpha-1 motor 3"
              />
              <Input
                label="Install date"
                type="date"
                value={selected.installDate ?? ""}
                onChange={(e) => update(selected.id, { installDate: e.target.value })}
              />
              <Input
                label="Inspection due (hours)"
                type="number"
                value={selected.inspectionDueHours?.toString() ?? ""}
                onChange={(e) =>
                  update(selected.id, {
                    inspectionDueHours: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                placeholder="25"
              />
              <Input
                label="Last inspected"
                type="date"
                value={selected.lastInspectedAt ?? ""}
                onChange={(e) => update(selected.id, { lastInspectedAt: e.target.value })}
              />
              <Input
                label="Total flight hours"
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
                label="Total flights"
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
    </Card>
  );
}
