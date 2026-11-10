"use client";

/**
 * @module fly/cockpit/HudLayer
 * @description The cockpit's centre HUD. The tapes and heading tape sit in
 * the flight screen's centre zone; the centre marks and the attitude
 * instruments sit on the main picture's centre (`videoRect`). At every layer level where `centre_marks` is on it draws the clean
 * centre (reticle, short horizon mark, small heading readout). Only at the
 * `instruments` level does it draw the flight instruments: artificial horizon
 * with pitch ladder, roll scale and flight-path marker; heading tape with the
 * home caret; scrolling speed and altitude tapes; vertical-speed indicator
 * and wind. The screen-reader summary is always present.
 *
 * The telemetry is derived ONCE here, once per animation frame, through
 * `useHudInstruments`, and each instrument receives its slice of that one
 * reading as props. Only this layer re-renders on telemetry; the cockpit root
 * and the other widgets do not, and a memoised instrument whose inputs did
 * not change does not either.
 * @license GPL-3.0-only
 */

import { useMemo, type CSSProperties } from "react";
import { useHudInstruments } from "@/hooks/use-hud-instruments";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useCockpitStore, type AltitudeReference } from "@/stores/cockpit-store";
import { AttitudeIndicator } from "@/components/cockpit/AttitudeIndicator";
import { AltTape, SpeedTape, VerticalSpeedIndicator } from "@/components/cockpit/Tapes";
import { HeadingTape } from "@/components/cockpit/hud/HeadingTape";
import { WindIndicator } from "@/components/cockpit/hud/WindIndicator";
import { HudSummary } from "@/components/cockpit/hud/HudSummary";
import { CentreMarks } from "@/components/cockpit/flight/CentreMarks";
import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { centreHeadingTop, rectStyle, videoRect } from "@/components/cockpit/flight/flight-grid";
import { effectiveLayers } from "@/lib/cockpit/layers/layer-spec";
import { specString } from "@/lib/cockpit/spec-strings";
import { useCockpitView } from "@/lib/cockpit/views";
import { useVehicleLayers } from "@/stores/cockpit-layers-store";

const CARDINALS = [specString("hud.card.n"), specString("hud.card.e"), specString("hud.card.s"), specString("hud.card.w")] as const;
const refText = (ref: AltitudeReference) => specString(`hud.alt_ref.${ref}`);

function AltRefToggle({
  altitudeRef,
  label,
  ariaLabel,
  onToggle,
}: {
  altitudeRef: AltitudeReference;
  label: string;
  ariaLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="alt-ref"
      data-ref={altitudeRef}
      aria-label={ariaLabel}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

export function HudLayer({ droneId }: { droneId: string }) {
  const reading = useHudInstruments();
  const grid = useFlightGrid();
  const layers = useVehicleLayers(droneId);
  const view = useCockpitView(droneId);
  const { vehicleClass } = useFirmwareCapabilities();
  const altitudeRef: AltitudeReference =
    useCockpitStore((s) => s.altitudeRef) === "msl" ? "msl" : "rel";
  const setAltitudeRef = useCockpitStore((s) => s.setAltitudeRef);

  // Airspeed only means something on a wing; on a multirotor VFR_HUD airspeed
  // is a ground-speed echo or a stray probe, so the tape stays on ground speed.
  const fixedWing = vehicleClass === "plane" || vehicleClass === "vtol";
  const useAirspeed = fixedWing && reading.airspeed !== null;
  const speed = useAirspeed ? reading.airspeed : reading.speedMps;
  const speedLabel = specString(useAirspeed ? "hud.ias" : "hud.gs");
  const alt = altitudeRef === "msl" ? reading.altMsl : reading.alt;
  const refLabel = refText(altitudeRef);

  const toggle = useMemo(() => {
    const next: AltitudeReference = altitudeRef === "msl" ? "rel" : "msl";
    return (
      <AltRefToggle
        altitudeRef={altitudeRef}
        label={refLabel}
        ariaLabel={specString("hud.alt_ref.toggle", { ref: refLabel, next: refText(next) })}
        onToggle={() => setAltitudeRef(next)}
      />
    );
  }, [altitudeRef, refLabel, setAltitudeRef]);

  const on = effectiveLayers(layers.level, layers.flips, view);
  const instruments = on.has("instruments");
  const marks = on.has("centre_marks") && !instruments;
  const centre = grid.zones.center;
  // The boresight marks and the attitude instruments sit on the main
  // picture's centre (the camera's optical axis), not on the centre zone
  // between the chrome; the tapes keep the centre zone. In the Map view the
  // picture is a small card, so the marks keep the centre zone.
  const origin = centre ?? { x: 0, y: 0, w: grid.width, h: grid.height };
  const pic = view === "map" ? origin : videoRect(view, grid);
  const boresight = {
    left: pic.x - origin.x,
    top: pic.y - origin.y,
    width: pic.w,
    height: pic.h,
    "--hdg-top": `${centreHeadingTop(pic, grid)}px`,
  } as CSSProperties;

  return (
    <div
      className="hud-layer"
      data-testid="hud-layer"
      data-level={layers.level}
      style={centre ? rectStyle(centre) : undefined}
    >
      {(marks || instruments) && (
        <div className="hud-picture-centre" data-testid="hud-picture-centre" style={boresight}>
          {marks && <CentreMarks reading={reading} />}
          {instruments && (
            <AttitudeIndicator
              pitch={reading.pitch}
              roll={reading.roll}
              flightPath={reading.flightPath}
              attFlagLabel={specString("hud.flag.att")}
            />
          )}
        </div>
      )}
      {instruments && (
        <div className="hud-instruments" data-testid="hud-instruments">
          <HeadingTape
            heading={reading.heading}
            homeBearing={reading.homeBearing}
            cardinals={CARDINALS}
            homeLabel={specString("layer.home")}
          />
          <SpeedTape value={speed} caption={speedLabel} />
          <AltTape value={alt} caption={`${specString("hud.alt")} ${refLabel}`} refToggle={toggle} />
          <VerticalSpeedIndicator value={reading.climb} caption={specString("hud.vs_label")} />
          <WindIndicator wind={reading.wind} heading={reading.heading} label={specString("hud.wind")} />
        </div>
      )}
      <HudSummary reading={reading} speed={speed} alt={alt} altitudeRef={altitudeRef} />
    </div>
  );
}
