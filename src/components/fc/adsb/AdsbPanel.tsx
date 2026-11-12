"use client";

import { useTranslations } from "next-intl";
import { Radar } from "lucide-react";
import { ParamFieldsPanel, type ParamSection } from "../shared/ParamFieldsPanel";

const SECTIONS: ParamSection[] = [
  {
    title: "ADS-B Receiver",
    fields: [
      { param: "ADSB_TYPE", label: "ADS-B Type", kind: "enum" },
      { param: "ADSB_LIST_MAX", label: "Max Tracked Aircraft", kind: "number", min: 0, max: 100, step: 1 },
      { param: "ADSB_LIST_RADIUS", label: "List Radius (m)", kind: "number", min: 0, max: 100000, step: 500 },
      { param: "ADSB_ICAO_ID", label: "Own ICAO ID", kind: "number", min: 0, max: 16777215, step: 1 },
      { param: "ADSB_EMIT_TYPE", label: "Emitter Type", kind: "enum" },
    ],
  },
  {
    title: "ADS-B Avoidance",
    fields: [
      { param: "AVD_ENABLE", label: "ADS-B Avoidance", kind: "enum" },
      { param: "AVD_F_ACTION", label: "Failsafe Action", kind: "enum" },
      { param: "AVD_F_DIST_XY", label: "Horizontal Distance (m)", kind: "number", min: 0, max: 10000, step: 10 },
      { param: "AVD_F_DIST_Z", label: "Vertical Distance (m)", kind: "number", min: 0, max: 1000, step: 5 },
    ],
  },
  {
    // Object/proximity avoidance (AVOID_*) exists only on Copter/Rover firmware;
    // gate the section so it never renders as raw numbers on a plane/VTOL.
    title: "Proximity Avoidance",
    collapsible: true,
    defaultOpen: false,
    vehicleClasses: ["copter", "rover"],
    fields: [
      { param: "AVOID_ENABLE", label: "Proximity Avoid", kind: "bitmask" },
      { param: "AVOID_MARGIN", label: "Margin (m)", kind: "number", min: 0, max: 20, step: 0.5 },
      { param: "AVOID_BEHAVE", label: "Behaviour", kind: "enum" },
    ],
  },
];

export function AdsbPanel() {
  const tr = useTranslations("fcPanels.adsbPanel");
  return (
    <ParamFieldsPanel
      panelId="adsb"
      title={tr("adsBAvoidance")}
      subtitle={tr("trafficAwarenessADSBPlus")}
      icon={<Radar size={16} />}
      sectionIcon={<Radar size={14} />}
      sections={SECTIONS}
    />
  );
}
