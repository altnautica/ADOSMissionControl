"use client";

/**
 * @module CanConfigPage
 * @description Top-level CAN configuration page composer.
 *
 * Layout: a sticky status banner at the top, a vertical tab strip on
 * the left listing the six sections, the active section on the right,
 * and a collapsible debug drawer pinned to the right edge.
 *
 * Bus setup, Node browser and Bus monitor work from parameters and the
 * frames the FC forwards. Per-node params, Diagnostics and Test utilities
 * talk to the nodes, so they run on the DroneCAN session the operator
 * opens from the session card; with none open they say so.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Cable, Cpu, Sliders, Activity, Stethoscope, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDroneManager } from "@/stores/drone-manager";
import { usePanelParams } from "@/hooks/use-panel-params";
import { CanStatusBanner } from "./CanStatusBanner";
import { BusSetupSection } from "./BusSetupSection";
import { NodeBrowserSection } from "./NodeBrowserSection";
import { BusMonitorSection } from "./BusMonitorSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { NodeParamEditor } from "./NodeParamEditor";
import { TestUtilitiesSection } from "./TestUtilitiesSection";
import { DebugDrawer } from "./debug/DebugDrawer";
import { CanSessionCard } from "./CanSessionCard";
import { useDroneCanSession } from "./use-dronecan-session";

type SectionId = "busSetup" | "nodeBrowser" | "perNodeParams" | "busMonitor" | "diagnostics" | "testUtilities";

const SECTION_ICONS: Record<SectionId, React.ReactNode> = {
  busSetup: <Cable size={14} />,
  nodeBrowser: <Cpu size={14} />,
  perNodeParams: <Sliders size={14} />,
  busMonitor: <Activity size={14} />,
  diagnostics: <Stethoscope size={14} />,
  testUtilities: <Wrench size={14} />,
};

// Shadow read of the CAN parameters so the status banner can render
// bitrates without forcing every section to mount up-front. The
// component does not render values; it simply ensures the param map
// is warm.
const STATUS_BANNER_PARAMS = [
  "CAN_P1_BITRATE",
  "CAN_P2_BITRATE",
  "CAN_SLCAN_CPORT",
] as const;
const STATUS_BANNER_PARAMS_OPTIONAL = [...STATUS_BANNER_PARAMS] as string[];

export function CanConfigPage() {
  const t = useTranslations("canConfig");
  const tSection = useTranslations("canConfig.sections");

  const selectedDrone = useDroneManager((s) => s.getSelectedDrone());
  const hasDrone = !!selectedDrone;
  const canForward = typeof selectedDrone?.protocol?.enableCanForward === "function";

  const { state: sessionState, open: openSession, close: closeSession } = useDroneCanSession();
  const client = sessionState.status === "open" ? sessionState.session.client : null;
  const transport = sessionState.status === "open" ? sessionState.session.transport : null;

  const [activeSection, setActiveSection] = useState<SectionId>("busSetup");
  const [selectedNodeIdForParams, setSelectedNodeIdForParams] = useState<number | null>(null);

  // Warm the param cache for the banner. This subscribes us to the
  // params map without rendering a panel UI, so banner readouts come
  // up immediately when the user lands on the page.
  const paramNames = useMemo(() => [...STATUS_BANNER_PARAMS], []);
  const optionalParams = useMemo(() => STATUS_BANNER_PARAMS_OPTIONAL, []);
  const { params } = usePanelParams({
    paramNames,
    optionalParams,
    panelId: "can-banner",
    autoLoad: hasDrone,
  });

  const sections: { id: SectionId; label: string }[] = [
    { id: "busSetup", label: tSection("busSetup") },
    { id: "nodeBrowser", label: tSection("nodeBrowser") },
    { id: "perNodeParams", label: tSection("perNodeParams") },
    { id: "busMonitor", label: tSection("busMonitor") },
    { id: "diagnostics", label: tSection("diagnostics") },
    { id: "testUtilities", label: tSection("testUtilities") },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 pt-6 pb-3">
        <h1 className="text-sm font-display font-semibold text-text-primary">{t("title")}</h1>
        <p className="text-[11px] text-text-tertiary mt-1">{t("subtitle")}</p>
      </div>

      <div className="px-6 pb-3">
        <CanStatusBanner params={params} />
      </div>

      {!hasDrone && (
        <div className="px-6 pb-3">
          <Card>
            <p className="text-xs text-text-tertiary text-center py-4">{t("noDrone")}</p>
          </Card>
        </div>
      )}

      {hasDrone && (
        <div className="px-6 pb-3">
          <CanSessionCard
            state={sessionState}
            canForward={canForward}
            onOpen={(bus) => void openSession(bus)}
            onClose={() => void closeSession()}
          />
        </div>
      )}

      <div className="flex-1 flex overflow-hidden border-t border-border-default">
        {/* Vertical section tabs */}
        <nav className="w-[200px] border-r border-border-default bg-bg-secondary flex-shrink-0 overflow-y-auto">
          <div className="flex flex-col py-1">
            {sections.map((section) => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors border-l-2",
                    isActive
                      ? "text-accent-primary bg-accent-primary/10 border-l-accent-primary"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary border-l-transparent",
                  )}
                >
                  {SECTION_ICONS[section.id]}
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Section body */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl">
            {activeSection === "busSetup" && <BusSetupSection />}
            {activeSection === "nodeBrowser" && (
              <NodeBrowserSection onSelectNode={(id) => {
                setSelectedNodeIdForParams(id);
                setActiveSection("perNodeParams");
              }} />
            )}
            {activeSection === "perNodeParams" && (
              selectedNodeIdForParams !== null ? (
                <NodeParamEditor
                  nodeId={selectedNodeIdForParams}
                  client={client}
                  onClose={() => setSelectedNodeIdForParams(null)}
                />
              ) : (
                <Card>
                  <p className="text-xs text-text-tertiary text-center py-4">
                    {tSection("perNodeParams")}
                  </p>
                </Card>
              )
            )}
            {activeSection === "busMonitor" && <BusMonitorSection />}
            {activeSection === "diagnostics" && <DiagnosticsSection client={client} />}
            {activeSection === "testUtilities" && <TestUtilitiesSection client={client} transport={transport} />}
          </div>
        </div>

        {/* Right-edge debug drawer — closed by default for the config page;
            surfaces the state ribbon only when an OTA is mid-flight. */}
        <DebugDrawer mode="config" />
      </div>
    </div>
  );
}
