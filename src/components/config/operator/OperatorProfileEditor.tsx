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
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import type { OperatorProfile } from "@/lib/types/operator";
import { listJurisdictions } from "@/lib/compliance/jurisdictions";

const JURISDICTION_OPTIONS = listJurisdictions().map((j) => ({ value: j.code, label: j.displayName }));

export function OperatorProfileEditor() {
  const tk = useTranslations("configUi.operatorProfileEditor");
  const t = useTranslations("operatorRegistry.profile");
  const profile = useOperatorProfileStore((s) => s.profile);
  const updateProfile = useOperatorProfileStore((s) => s.updateProfile);

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
      <Card title={t("pilot")} padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("firstName")}
            value={draft.pilotFirstName ?? ""}
            onChange={(e) => set("pilotFirstName", e.target.value)}
          />
          <Input
            label={t("lastName")}
            value={draft.pilotLastName ?? ""}
            onChange={(e) => set("pilotLastName", e.target.value)}
          />
          <Input
            label={t("dateOfBirth")}
            type="date"
            value={draft.pilotDob ?? ""}
            onChange={(e) => set("pilotDob", e.target.value)}
          />
          <Input
            label={t("licenseNumber")}
            value={draft.pilotLicenseNumber ?? ""}
            onChange={(e) => set("pilotLicenseNumber", e.target.value)}
            placeholder={t("licenseNumberPlaceholder")}
          />
          <Input
            label={t("licenseIssuer")}
            value={draft.pilotLicenseIssuer ?? ""}
            onChange={(e) => set("pilotLicenseIssuer", e.target.value)}
            placeholder="DGCA / FAA / EASA / CAA UK"
          />
          <Input
            label={t("licenseClass")}
            value={draft.pilotLicenseClass ?? ""}
            onChange={(e) => set("pilotLicenseClass", e.target.value)}
            placeholder={tk("smallPart107A2STS")}
          />
          <Input
            label={t("licenseExpiry")}
            type="date"
            value={draft.pilotLicenseExpiry ?? ""}
            onChange={(e) => set("pilotLicenseExpiry", e.target.value)}
          />
          <Input
            label={t("priorPicHours")}
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
            label={t("faaTrustId")}
            value={draft.pilotTrustId ?? ""}
            onChange={(e) => set("pilotTrustId", e.target.value)}
          />
        </div>
      </Card>

      <Card title={t("organisation")} padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("operatorName")}
            value={draft.operatorName ?? ""}
            onChange={(e) => set("operatorName", e.target.value)}
          />
          <Input
            label={t("operatorCertNumber")}
            value={draft.operatorCertNumber ?? ""}
            onChange={(e) => set("operatorCertNumber", e.target.value)}
            placeholder={tk("reocOALUCPart107")}
          />
          <Input
            label={t("certIssuer")}
            value={draft.operatorCertIssuer ?? ""}
            onChange={(e) => set("operatorCertIssuer", e.target.value)}
          />
          <Input
            label={t("certExpiry")}
            type="date"
            value={draft.operatorCertExpiry ?? ""}
            onChange={(e) => set("operatorCertExpiry", e.target.value)}
          />
          <Input
            label={t("address")}
            value={draft.operatorAddress ?? ""}
            onChange={(e) => set("operatorAddress", e.target.value)}
            className="col-span-2"
          />
        </div>
      </Card>

      <Card title={t("insurance")} padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("insurer")}
            value={draft.insurerName ?? ""}
            onChange={(e) => set("insurerName", e.target.value)}
          />
          <Input
            label={t("policyNumber")}
            value={draft.insurancePolicyNumber ?? ""}
            onChange={(e) => set("insurancePolicyNumber", e.target.value)}
          />
          <Input
            label={t("policyExpiry")}
            type="date"
            value={draft.insuranceExpiry ?? ""}
            onChange={(e) => set("insuranceExpiry", e.target.value)}
          />
          <Input
            label={t("coverageAmount")}
            value={draft.insuranceCoverageAmount ?? ""}
            onChange={(e) => set("insuranceCoverageAmount", e.target.value)}
            placeholder="USD 1,000,000"
          />
        </div>
      </Card>

      <Card title={t("defaults")} padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t("defaultJurisdiction")}
            value={draft.defaultJurisdiction ?? ""}
            onChange={(v) => {
              set("defaultJurisdiction", v || undefined);
              updateProfile({ defaultJurisdiction: v || undefined });
            }}
            placeholder={t("notSet")}
            options={JURISDICTION_OPTIONS}
          />
        </div>
      </Card>
    </div>
  );
}
