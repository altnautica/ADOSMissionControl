"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DataValue } from "@/components/ui/data-value";
import { useToast } from "@/components/ui/toast";
import { Download, Trash2 } from "lucide-react";

export function DataSection() {
  const t = useTranslations("data");
  const [retention, setRetention] = useState("24h");
  const { toast } = useToast();

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">{t("title")}</h2>

      <Card>
        <div className="space-y-4">
          <Select
            label={t("telemetryRetention")}
            value={retention}
            onChange={setRetention}
            options={[
              { value: "1h", label: t("hour") },
              { value: "6h", label: t("hours6") },
              { value: "24h", label: t("hours24") },
              { value: "7d", label: t("days7") },
            ]}
          />

          <DataValue label={t("storageUsed")} value="12.4" unit="MB" />
        </div>
      </Card>

      <Card title={t("actionsTitle")}>
        <div className="space-y-3">
          <Button
            variant="secondary"
            icon={<Download size={14} />}
            onClick={() => toast(t("exportUnavailable"), "info")}
            className="w-full"
          >
            {t("exportFlight")}
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 size={14} />}
            onClick={() => toast(t("cacheCleared"), "success")}
            className="w-full"
          >
            {t("clearCache")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
