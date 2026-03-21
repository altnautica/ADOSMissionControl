"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { BatteryBar } from "@/components/shared/battery-bar";
import { SensorHealthBar } from "@/components/shared/SensorHealthBar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useDroneMetadataStore, type DroneMetadata } from "@/stores/drone-metadata-store";
import { getJurisdictionConfig } from "@/lib/jurisdiction";
import { Pencil, Check, X } from "lucide-react";
import type { FleetDrone, SuiteType } from "@/lib/types";

interface CompactInfoCardsProps {
  drone: FleetDrone;
}

type EditSection = "vehicle" | "identity" | "stats" | null;

// Weight and suite options are built inside the component with translations

function MetricCell({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="bg-bg-tertiary/50 rounded px-2.5 py-2">
      <p className="text-sm font-mono font-semibold text-text-primary tabular-nums truncate">
        {value}
        {unit && <span className="text-[10px] text-text-tertiary ml-0.5">{unit}</span>}
      </p>
      <p className="text-[10px] text-text-tertiary mt-0.5">{label}</p>
    </div>
  );
}

function Section({
  title,
  editable,
  editing,
  onEdit,
  onSave,
  onCancel,
  children,
}: {
  title: string;
  editable?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border-default px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {title}
        </h4>
        {editable && !editing && (
          <button
            onClick={onEdit}
            className="p-0.5 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          >
            <Pencil size={10} />
          </button>
        )}
        {editing && (
          <div className="flex items-center gap-1">
            <button
              onClick={onSave}
              className="p-0.5 text-status-success hover:text-status-success/80 transition-colors cursor-pointer"
            >
              <Check size={12} />
            </button>
            <button
              onClick={onCancel}
              className="p-0.5 text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function EditField({ label, value, onChange, type = "text" }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="bg-bg-tertiary/50 rounded px-2 py-1.5">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm font-mono font-semibold text-text-primary bg-transparent outline-none border-b border-accent-primary/40 pb-0.5"
      />
      <p className="text-[10px] text-text-tertiary mt-0.5">{label}</p>
    </div>
  );
}

function EditSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="bg-bg-tertiary/50 rounded px-2 py-1.5">
      <Select
        value={value}
        onChange={onChange}
        options={options}
      />
      <p className="text-[10px] text-text-tertiary mt-0.5">{label}</p>
    </div>
  );
}

export function CompactInfoCards({ drone }: CompactInfoCardsProps) {
  const t = useTranslations("flightInfo");
  const jurisdiction = useSettingsStore((s) => s.jurisdiction);

  const WEIGHT_OPTIONS = useMemo(() => [
    { value: "Micro", label: t("micro") },
    { value: "Small", label: t("small") },
    { value: "Medium", label: t("medium") },
    { value: "Large", label: t("large") },
  ], [t]);

  const SUITE_OPTIONS = useMemo(() => [
    { value: "none", label: t("noSuite") },
    { value: "sentry", label: t("sentry") },
    { value: "survey", label: t("survey") },
    { value: "agriculture", label: t("agriculture") },
    { value: "cargo", label: t("cargo") },
    { value: "sar", label: t("sar") },
    { value: "inspection", label: t("inspection") },
  ], [t]);
  const jConfig = getJurisdictionConfig(jurisdiction);
  const metadata = useDroneMetadataStore((s) => s.profiles[drone.id]);
  const upsertProfile = useDroneMetadataStore((s) => s.upsertProfile);

  const [editingSection, setEditingSection] = useState<EditSection>(null);

  // Local edit state for Vehicle
  const [editCompute, setEditCompute] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editSuite, setEditSuite] = useState("");

  // Local edit state for Identity
  const [editName, setEditName] = useState("");
  const [editSerial, setEditSerial] = useState("");
  const [editRegistration, setEditRegistration] = useState("");

  // Local edit state for Stats
  const [editFlights, setEditFlights] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editEnrolled, setEditEnrolled] = useState("");

  function startEdit(section: EditSection) {
    if (section === "vehicle") {
      setEditCompute(metadata?.computeModule ?? "");
      setEditWeight(metadata?.weightClass ?? "");
      setEditSuite(metadata?.suiteType ?? "none");
    } else if (section === "identity") {
      setEditName(metadata?.displayName ?? drone.name);
      setEditSerial(metadata?.serial ?? "");
      setEditRegistration(metadata?.registration ?? "");
    } else if (section === "stats") {
      setEditFlights(String(metadata?.totalFlights ?? 0));
      setEditHours(String(metadata?.totalHours ?? 0));
      const enrolled = metadata?.enrolledAt ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
      setEditEnrolled(new Date(enrolled).toISOString().split("T")[0]);
    }
    setEditingSection(section);
  }

  function saveVehicle() {
    upsertProfile(drone.id, {
      computeModule: editCompute,
      weightClass: editWeight,
      suiteType: editSuite === "none" ? null : editSuite as SuiteType,
    });
    setEditingSection(null);
  }

  function saveIdentity() {
    upsertProfile(drone.id, {
      displayName: editName,
      serial: editSerial,
      registration: editRegistration,
    });
    setEditingSection(null);
  }

  function saveStats() {
    upsertProfile(drone.id, {
      totalFlights: parseInt(editFlights) || 0,
      totalHours: parseFloat(editHours) || 0,
      enrolledAt: new Date(editEnrolled).getTime() || Date.now(),
    });
    setEditingSection(null);
  }

  return (
    <div className="bg-bg-secondary">
      {/* Health — READ-ONLY */}
      <Section title={t("health")}>
        <SensorHealthBar compact />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <MetricCell label={t("health")} value={drone.healthScore} unit="%" />
          <MetricCell label={t("voltage")} value={(drone.battery?.voltage ?? 0).toFixed(1)} unit="V" />
          <MetricCell label={t("gpsSats")} value={drone.gps?.satellites ?? 0} />
          <MetricCell label={t("fixType")} value={drone.gps?.fixType && drone.gps.fixType >= 3 ? "3D" : drone.gps?.fixType === 2 ? "2D" : "No Fix"} />
        </div>
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-1">
            <span>{t("battery")}</span>
            <span className="font-mono tabular-nums">{Math.round(drone.battery?.remaining ?? 0)}%</span>
          </div>
          <BatteryBar percentage={drone.battery?.remaining ?? 0} />
        </div>
      </Section>

      {/* Vehicle — EDITABLE */}
      <Section
        title={t("vehicleInfo")}
        editable
        editing={editingSection === "vehicle"}
        onEdit={() => startEdit("vehicle")}
        onSave={saveVehicle}
        onCancel={() => setEditingSection(null)}
      >
        {editingSection === "vehicle" ? (
          <div className="grid grid-cols-2 gap-2">
            <MetricCell label={t("frame")} value={drone.frameType || "copter"} />
            <MetricCell label={t("firmware")} value={drone.firmwareVersion || "ArduCopter"} />
            <EditField label={t("compute")} value={editCompute} onChange={setEditCompute} />
            <EditSelect label={t("weight")} value={editWeight} onChange={setEditWeight} options={WEIGHT_OPTIONS} />
            <EditSelect
              label={t("suite")}
              value={editSuite}
              onChange={setEditSuite}
              options={SUITE_OPTIONS}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MetricCell label={t("frame")} value={drone.frameType || "copter"} />
            <MetricCell label={t("firmware")} value={drone.firmwareVersion || "ArduCopter"} />
            <MetricCell label={t("compute")} value={metadata?.computeModule || "—"} />
            <MetricCell label={t("weight")} value={metadata?.weightClass || "—"} />
            {(metadata?.suiteType) && (
              <MetricCell label={t("suite")} value={metadata.suiteType} />
            )}
          </div>
        )}
      </Section>

      {/* Identity — EDITABLE */}
      <Section
        title={t("identity")}
        editable
        editing={editingSection === "identity"}
        onEdit={() => startEdit("identity")}
        onSave={saveIdentity}
        onCancel={() => setEditingSection(null)}
      >
        {editingSection === "identity" ? (
          <div className="grid grid-cols-2 gap-2">
            <EditField label={t("name")} value={editName} onChange={setEditName} />
            <MetricCell label={t("id")} value={drone.id} />
            <EditField label={t("serial")} value={editSerial} onChange={setEditSerial} />
            <EditField label={jConfig.registrationLabel} value={editRegistration} onChange={setEditRegistration} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MetricCell label={t("name")} value={metadata?.displayName ?? drone.name} />
            <MetricCell label={t("id")} value={drone.id} />
            <MetricCell label={t("serial")} value={metadata?.serial || "—"} />
            <MetricCell label={jConfig.registrationLabel} value={metadata?.registration || "—"} />
          </div>
        )}
      </Section>

      {/* Stats — EDITABLE */}
      <Section
        title={t("statistics")}
        editable
        editing={editingSection === "stats"}
        onEdit={() => startEdit("stats")}
        onSave={saveStats}
        onCancel={() => setEditingSection(null)}
      >
        {editingSection === "stats" ? (
          <div className="grid grid-cols-2 gap-2">
            <EditField label={t("totalFlights")} value={editFlights} onChange={setEditFlights} type="number" />
            <EditField label={t("hours")} value={editHours} onChange={setEditHours} type="number" />
            <EditField label={t("enrolled")} value={editEnrolled} onChange={setEditEnrolled} type="date" />
            <MetricCell label={t("lastFlight")} value={formatDate(drone.lastHeartbeat)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MetricCell label={t("totalFlights")} value={metadata?.totalFlights ?? 0} />
            <MetricCell label={t("hours")} value={metadata?.totalHours ?? 0} unit="h" />
            <MetricCell label={t("enrolled")} value={formatDate(metadata?.enrolledAt ?? Date.now() - 30 * 24 * 60 * 60 * 1000)} />
            <MetricCell label={t("lastFlight")} value={formatDate(drone.lastHeartbeat)} />
          </div>
        )}
      </Section>
    </div>
  );
}
