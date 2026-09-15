"use client";

/**
 * @module command/settings/DisplaySection
 * @description The node Settings "Display" page: the ground station's
 * boot-critical local-display renderer plus the HDMI kiosk it feeds.
 *
 * `ground_station.display.type` had no home in the node-configuration IA at
 * all — no settings page covered `ground_station.*` — so the only way to
 * change it was a bespoke picker on a hardware card. That matters because the
 * key is boot-critical: the display service gates its early startup on it, and
 * choosing a renderer that is not wired takes the on-box UI dark at the next
 * start, which is exactly the UI an operator uses to recover a node whose
 * network is down.
 *
 * Neither picker is re-implemented here. The page renders
 * {@link LocalDisplayCard}, which owns the presence detection (offer a renderer
 * only when the node reports it) and the danger confirmation, and
 * {@link HdmiKioskCard}, which already owns the kiosk target-URL write. One
 * key, one write path: a second picker is how the two drift and one of them
 * loses the guard. The only field added here is `ground_station.kiosk.enabled`,
 * which no surface exposed at all.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Monitor } from "lucide-react";

import { HdmiKioskCard } from "@/components/hardware/HdmiKioskCard";
import { LocalDisplayCard } from "@/components/hardware/LocalDisplayCard";
import { ConfigToggleField } from "./ConfigFields";
import { Section } from "./Section";

export interface DisplaySectionProps {
  nodeDeviceId: string | null;
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

export function DisplaySection({
  nodeDeviceId,
  config,
  readOnly,
  setValue,
}: DisplaySectionProps) {
  const t = useTranslations("nodeSettings.display");

  return (
    <div className="space-y-4">
      <Section title={t("rendererTitle")} icon={Monitor} blurb={t("rendererBlurb")}>
        {/* The presence-gated, confirmation-guarded picker. */}
        <LocalDisplayCard nodeDeviceId={nodeDeviceId} />
      </Section>

      <Section title={t("kioskTitle")} blurb={t("kioskBlurb")}>
        <ConfigToggleField
          configKey="ground_station.kiosk.enabled"
          label={t("kioskEnabled")}
          hint={t("kioskEnabledHint")}
          config={config}
          readOnly={readOnly}
          setValue={setValue}
        />
        {/* The kiosk target URL's existing owner — reused, not re-implemented. */}
        <HdmiKioskCard nodeDeviceId={nodeDeviceId} />
      </Section>
    </div>
  );
}
