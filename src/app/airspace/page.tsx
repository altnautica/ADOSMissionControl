/**
 * @module AirTrafficPage
 * @description Airspace tab page. Full-screen CesiumJS 3D globe with
 * airspace zones and flyability assessment.
 * @license GPL-3.0-only
 */

"use client";

import dynamic from "next/dynamic";

const AirTrafficViewer = dynamic(
  () =>
    import("@/components/air-traffic/AirTrafficViewer").then((m) => m.AirTrafficViewer),
  { ssr: false }
);

export default function AirTrafficPage() {
  return (
    <div className="flex-1 flex h-full overflow-hidden">
      <AirTrafficViewer />
    </div>
  );
}
