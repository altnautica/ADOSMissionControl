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

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import type { AircraftRecord, VehicleType, AircraftCategory } from "@/lib/types/operator";

const VEHICLE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: "copter", label: "Multirotor" },
  { value: "plane", label: "Plane" },
  { value: "vtol", label: "VTOL" },
  { value: "rover", label: "Rover" },
  { value: "sub", label: "Sub" },
];

const CATEGORY_OPTIONS: { value: AircraftCategory; label: string }[] = [
  { value: "nano", label: "Nano (<250 g)" },
  { value: "micro", label: "Micro (≤2 kg)" },
  { value: "small", label: "Small (≤25 kg)" },
  { value: "medium", label: "Medium (≤150 kg)" },
  { value: "large", label: "Large (>150 kg)" },
];

export function AircraftRegistryEditor() {
  const aircraftMap = useAircraftRegistryStore((s) => s.aircraft);
  const upsert = useAircraftRegistryStore((s) => s.upsert);
  const update = useAircraftRegistryStore((s) => s.update);
  const remove = useAircraftRegistryStore((s) => s.remove);
  const loadFromIDB = useAircraftRegistryStore((s) => s.loadFromIDB);

  useEffect(() => {
    void loadFromIDB();
  }, [loadFromIDB]);

  const aircraft = Object.values(aircraftMap);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? aircraftMap[selectedId] : undefined;

  const handleAdd = () => {
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fresh: AircraftRecord = {
      id,
      name: "New aircraft",
      vehicleType: "copter",
      totalFlightHours: 0,
      totalFlights: 0,
    };
    upsert(fresh);
    setSelectedId(id);
  };

  const handleDelete = (id: string) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this aircraft record?")) return;
    remove(id);
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <Card title="Aircraft" padding={true}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-secondary">
            {aircraft.length} aircraft registered
          </span>
          <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={handleAdd}>
            Add aircraft
          </Button>
        </div>

        {aircraft.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">
            No aircraft yet. Connect a drone to auto-create an entry, or click Add.
          </p>
        ) : (
          <div className="border border-border-default rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Name</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Reg</th>
                  <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Type</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">Hours</th>
                  <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">Flights</th>
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
                    <td className="px-2 py-1.5 text-text-secondary">{a.vehicleType ?? "—"}</td>
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
                          handleDelete(a.id);
                        }}
                        className="text-text-tertiary hover:text-status-error transition-colors"
                        aria-label="Delete"
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
                label="Name"
                value={selected.name}
                onChange={(e) => update(selected.id, { name: e.target.value })}
              />
              <Input
                label="Registration"
                value={selected.registrationNumber ?? ""}
                onChange={(e) => update(selected.id, { registrationNumber: e.target.value })}
                placeholder="UIN / N-number / EASA reg"
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
                value={selected.serialNumber ?? ""}
                onChange={(e) => update(selected.id, { serialNumber: e.target.value })}
              />
              <Input
                label="Remote ID serial"
                value={selected.remoteIdSerial ?? ""}
                onChange={(e) => update(selected.id, { remoteIdSerial: e.target.value })}
              />
              <Select
                label="Vehicle type"
                value={selected.vehicleType ?? "copter"}
                onChange={(v) => update(selected.id, { vehicleType: v as VehicleType })}
                options={VEHICLE_OPTIONS}
              />
              <Select
                label="Category"
                value={selected.category ?? "small"}
                onChange={(v) => update(selected.id, { category: v as AircraftCategory })}
                options={CATEGORY_OPTIONS}
              />
              <Input
                label="MTOM (kg)"
                type="number"
                step="0.1"
                value={selected.mtomKg?.toString() ?? ""}
                onChange={(e) => update(selected.id, { mtomKg: e.target.value ? Number(e.target.value) : undefined })}
              />
              <Input
                label="Airworthiness cert"
                value={selected.airworthinessCertNumber ?? ""}
                onChange={(e) => update(selected.id, { airworthinessCertNumber: e.target.value })}
              />
              <Input
                label="Airworthiness expiry"
                type="date"
                value={selected.airworthinessExpiry ?? ""}
                onChange={(e) => update(selected.id, { airworthinessExpiry: e.target.value })}
              />
              <Input
                label="Last maintenance"
                type="date"
                value={selected.lastMaintenanceDate ?? ""}
                onChange={(e) => update(selected.id, { lastMaintenanceDate: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
