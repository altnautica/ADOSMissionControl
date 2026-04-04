"use client";

import { useTranslations } from "next-intl";
import { useFleetStore } from "@/stores/fleet-store";
import { AlertRow } from "@/components/shared/alert-row";
import { Card } from "@/components/ui/card";

export function AlertFeed() {
  const t = useTranslations("dashboard");
  const alerts = useFleetStore((s) => s.alerts);
  const acknowledgeAlert = useFleetStore((s) => s.acknowledgeAlert);

  const recent = alerts.slice(0, 10);

  return (
    <Card title={t("alertFeed.title")} padding={false}>
      {recent.length === 0 ? (
        <div className="px-3 py-4 text-xs text-text-tertiary text-center">
          {t("alertFeed.noAlerts")}
        </div>
      ) : (
        <div>
          {recent.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onAcknowledge={acknowledgeAlert}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
