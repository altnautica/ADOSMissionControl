"use client";

/**
 * @module DisplayTab
 * @description Command-tab home for the LCD-related cards: status,
 * live preview, remote control, theme toggle, touch calibration,
 * camera switch, recording monitor. Calibration is captured on the
 * device panel itself (the operator taps the crosshairs shown on the
 * LCD); the live preview mirrors it and the status pill reflects the
 * result. Lifted from the prior /hardware/display route.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { LocalDisplayCard } from "@/components/hardware/LocalDisplayCard";
import { HdmiKioskCard } from "@/components/hardware/HdmiKioskCard";
import { CloudModeLimitedNotice } from "@/components/command/shared/CloudModeLimitedNotice";
import { LcdPagePreview } from "@/components/hardware/LcdPagePreview";
import { LcdRemoteControl } from "@/components/hardware/LcdRemoteControl";
import { LcdThemeToggle } from "@/components/hardware/LcdThemeToggle";
import { LcdCameraSwitch } from "@/components/hardware/LcdCameraSwitch";
import { LcdRecordingMonitor } from "@/components/hardware/LcdRecordingMonitor";
import { PageIntro } from "@/components/hardware/PageIntro";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

export function DisplayTab() {
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const t = useTranslations("hardware.displayPage");

  if (!agentUrl) {
    return (
      <div className="flex flex-col">
        <PageIntro title={t("title")} description={t("description")} />
        <CloudModeLimitedNotice feature="display" />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageIntro title={t("title")} description={t("description")} />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LocalDisplayCard />
          </div>
          <div>
            <LcdPagePreview />
          </div>
        </div>

        <HdmiKioskCard />

        <LcdRemoteControl />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LcdThemeToggle />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <LcdCameraSwitch />
          </div>
          <div>
            <LcdRecordingMonitor />
          </div>
        </div>
      </div>
    </div>
  );
}
