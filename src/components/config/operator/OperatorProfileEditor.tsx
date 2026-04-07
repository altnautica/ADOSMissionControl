"use client";

/**
 * Operator profile editor — pilot, organisation, insurance, defaults.
 *
 * Reads from and writes to {@link useOperatorProfileStore}. Every field is
 * optional. Save is implicit on blur to keep this consistent with the rest
 * of the app's settings pattern.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import type { OperatorProfile } from "@/lib/types/operator";

const UNIT_OPTIONS = [
  { value: "metric", label: "Metric (m, km/h, °C)" },
  { value: "imperial", label: "Imperial (ft, mph, °F)" },
];

export function OperatorProfileEditor() {
  const profile = useOperatorProfileStore((s) => s.profile);
  const updateProfile = useOperatorProfileStore((s) => s.updateProfile);
  const loadFromIDB = useOperatorProfileStore((s) => s.loadFromIDB);

  useEffect(() => {
    void loadFromIDB();
  }, [loadFromIDB]);

  const [draft, setDraft] = useState<OperatorProfile>(profile);

  // Re-sync draft when the underlying profile changes (e.g. IDB load).
  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  const set = <K extends keyof OperatorProfile>(key: K, value: OperatorProfile[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const commit = () => {
    updateProfile(draft);
  };

  return (
    <div className="flex flex-col gap-3" onBlur={commit}>
      <Card title="Pilot" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="First name"
            value={draft.pilotFirstName ?? ""}
            onChange={(e) => set("pilotFirstName", e.target.value)}
          />
          <Input
            label="Last name"
            value={draft.pilotLastName ?? ""}
            onChange={(e) => set("pilotLastName", e.target.value)}
          />
          <Input
            label="Date of birth"
            type="date"
            value={draft.pilotDob ?? ""}
            onChange={(e) => set("pilotDob", e.target.value)}
          />
          <Input
            label="License number"
            value={draft.pilotLicenseNumber ?? ""}
            onChange={(e) => set("pilotLicenseNumber", e.target.value)}
            placeholder="e.g. RPL-12345"
          />
          <Input
            label="License issuer"
            value={draft.pilotLicenseIssuer ?? ""}
            onChange={(e) => set("pilotLicenseIssuer", e.target.value)}
            placeholder="DGCA / FAA / EASA / CAA UK"
          />
          <Input
            label="License class"
            value={draft.pilotLicenseClass ?? ""}
            onChange={(e) => set("pilotLicenseClass", e.target.value)}
            placeholder="Small / Part 107 / A2 / STS-01"
          />
          <Input
            label="License expiry"
            type="date"
            value={draft.pilotLicenseExpiry ?? ""}
            onChange={(e) => set("pilotLicenseExpiry", e.target.value)}
          />
          <Input
            label="Prior PIC hours"
            type="number"
            value={draft.pilotTotalHoursPriorPic?.toString() ?? ""}
            onChange={(e) => set("pilotTotalHoursPriorPic", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="0"
          />
          <Input
            label="CASA ARN"
            value={draft.pilotArn ?? ""}
            onChange={(e) => set("pilotArn", e.target.value)}
          />
          <Input
            label="FAA TRUST id"
            value={draft.pilotTrustId ?? ""}
            onChange={(e) => set("pilotTrustId", e.target.value)}
          />
        </div>
      </Card>

      <Card title="Organisation" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Operator name"
            value={draft.operatorName ?? ""}
            onChange={(e) => set("operatorName", e.target.value)}
          />
          <Input
            label="Operator certificate number"
            value={draft.operatorCertNumber ?? ""}
            onChange={(e) => set("operatorCertNumber", e.target.value)}
            placeholder="ReOC / OA / LUC / Part 107 Waiver"
          />
          <Input
            label="Certificate issuer"
            value={draft.operatorCertIssuer ?? ""}
            onChange={(e) => set("operatorCertIssuer", e.target.value)}
          />
          <Input
            label="Certificate expiry"
            type="date"
            value={draft.operatorCertExpiry ?? ""}
            onChange={(e) => set("operatorCertExpiry", e.target.value)}
          />
          <Input
            label="Address"
            value={draft.operatorAddress ?? ""}
            onChange={(e) => set("operatorAddress", e.target.value)}
            className="col-span-2"
          />
        </div>
      </Card>

      <Card title="Insurance" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Insurer"
            value={draft.insurerName ?? ""}
            onChange={(e) => set("insurerName", e.target.value)}
          />
          <Input
            label="Policy number"
            value={draft.insurancePolicyNumber ?? ""}
            onChange={(e) => set("insurancePolicyNumber", e.target.value)}
          />
          <Input
            label="Policy expiry"
            type="date"
            value={draft.insuranceExpiry ?? ""}
            onChange={(e) => set("insuranceExpiry", e.target.value)}
          />
          <Input
            label="Coverage amount"
            value={draft.insuranceCoverageAmount ?? ""}
            onChange={(e) => set("insuranceCoverageAmount", e.target.value)}
            placeholder="USD 1,000,000"
          />
        </div>
      </Card>

      <Card title="Defaults" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Default jurisdiction"
            value={draft.defaultJurisdiction ?? ""}
            onChange={(e) => set("defaultJurisdiction", e.target.value)}
            placeholder="IN_DGCA / US_FAA_PART107 / EU_EASA_OPEN…"
          />
          <Input
            label="Time zone"
            value={draft.defaultTimeZone ?? ""}
            onChange={(e) => set("defaultTimeZone", e.target.value)}
            placeholder="Asia/Kolkata"
          />
          <Select
            label="Units"
            value={draft.units ?? "metric"}
            onChange={(v) => set("units", v as "metric" | "imperial")}
            options={UNIT_OPTIONS}
          />
        </div>
      </Card>
    </div>
  );
}
