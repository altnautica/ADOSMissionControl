"use client";

/**
 * Aircraft registry editor — table of all known aircraft + per-row edit form.
 *
 * Reads from {@link useAircraftRegistryStore}. Aircraft are auto-seeded by
 * the flight lifecycle on first connect, but can also be manually added here
 * for off-platform / pre-existing fleet entries.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Trash2 } from "lucide-react";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import type { AircraftRecord, VehicleType, AircraftCategory } from "@/lib/types/operator";

const VEHICLE_TYPES: VehicleType[] = ["copter", "plane", "vtol", "rover", "sub"];
const CATEGORIES: AircraftCategory[] = ["nano", "micro", "small", "medium", "large"];

export function AircraftRegistryEditor() {
  const t = useTranslations("operatorRegistry.aircraft");
  const aircraftMap = useAircraftRegistryStore((s) => s.aircraft);
  const upsert = useAircraftRegistryStore((s) => s.upsert);
  const update = useAircraftRegistryStore((s) => s.update);
  const remove = useAircraftRegistryStore((s) => s.remove);

  const aircraft = Object.values(aircraftMap);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const selected = selectedId ? aircraftMap[selectedId] : undefined;

  const vehicleOptions = VEHICLE_TYPES.map((value) => ({ value, label: t(`vehicleType.${value}`) }));
  const categoryOptions = CATEGORIES.map((value) => ({ value, label: t(`category.${value}`) }));

  const handleAdd = () => {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fresh: AircraftRecord = {
      id,
      name: t("newName"),
      vehicleType: "copter",
      totalFlightHours: 0,
      totalFlights: 0,
    };
    upsert(fresh);
    setSelectedId(id);
  };

  const confirmDelete = () => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (!id) return;
    remove(id);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <Card title={t("title")} padding={true}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-secondary">
            {t("registeredCount", { count: aircraft.length })}
          </span>
          <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={handleAdd}>
            {t("add")}
          </Button>
        </div>

        {aircraft.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">{t("empty")}</p>
        ) : (
          <div className="border border-border-default rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">{t("colName")}</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">{t("colReg")}</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">{t("colType")}</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">{t("colHours")}</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">{t("colFlights")}</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {aircraft.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className={`border-b border-border-default cursor-pointer hover:bg-bg-tertiary ${
                      selectedId === a.id ? "bg-accent-primary/10" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5 text-text-primary">{a.name}</td>
                    <td className="px-2 py-1.5 text-text-primary font-mono">{a.registrationNumber ?? "—"}</td>
                    <td className="px-2 py-1.5 text-text-secondary">
                      {a.vehicleType ? t(`vehicleType.${a.vehicleType}`) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-text-primary font-mono text-right tabular-nums">
                      {(a.totalFlightHours ?? 0).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-text-primary font-mono text-right tabular-nums">
                      {a.totalFlights ?? 0}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(a.id);
                        }}
                        className="text-text-tertiary hover:text-status-error transition-colors"
                        aria-label={t("delete")}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected && (
          <div className="border-t border-border-default pt-3">
            <h4 className="text-[11px] uppercase tracking-wider text-text-secondary mb-2">
              {selected.name}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t("name")}
                value={selected.name}
                onChange={(e) => update(selected.id, { name: e.target.value })}
              />
              <Input
                label={t("registration")}
                value={selected.registrationNumber ?? ""}
                onChange={(e) => update(selected.id, { registrationNumber: e.target.value })}
                placeholder={t("registrationPlaceholder")}
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
                value={selected.serialNumber ?? ""}
                onChange={(e) => update(selected.id, { serialNumber: e.target.value })}
              />
              <Input
                label={t("remoteIdSerial")}
                value={selected.remoteIdSerial ?? ""}
                onChange={(e) => update(selected.id, { remoteIdSerial: e.target.value })}
              />
              <Select
                label={t("vehicleTypeLabel")}
                value={selected.vehicleType ?? "copter"}
                onChange={(v) => update(selected.id, { vehicleType: v as VehicleType })}
                options={vehicleOptions}
              />
              <Select
                label={t("categoryLabel")}
                value={selected.category ?? "small"}
                onChange={(v) => update(selected.id, { category: v as AircraftCategory })}
                options={categoryOptions}
              />
              <Input
                label={t("mtomKg")}
                type="number"
                step="0.1"
                value={selected.mtomKg?.toString() ?? ""}
                onChange={(e) => update(selected.id, { mtomKg: e.target.value ? Number(e.target.value) : undefined })}
              />
              <Input
                label={t("airworthinessCert")}
                value={selected.airworthinessCertNumber ?? ""}
                onChange={(e) => update(selected.id, { airworthinessCertNumber: e.target.value })}
              />
              <Input
                label={t("airworthinessExpiry")}
                type="date"
                value={selected.airworthinessExpiry ?? ""}
                onChange={(e) => update(selected.id, { airworthinessExpiry: e.target.value })}
              />
              <Input
                label={t("lastMaintenance")}
                type="date"
                value={selected.lastMaintenanceDate ?? ""}
                onChange={(e) => update(selected.id, { lastMaintenanceDate: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
        title={t("deleteTitle")}
        message={t("deleteMessage")}
        confirmLabel={t("delete")}
        variant="danger"
      />
    </Card>
  );
}
