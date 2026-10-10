"use client";

/**
 * @module fly/cockpit/HudLayer
 * @description The cockpit instrument HUD: artificial horizon with pitch
 * ladder, roll scale and flight-path marker; heading tape with the home
 * caret; scrolling speed and altitude tapes; vertical-speed indicator; wind;
 * compact readouts for a narrow cockpit; and a screen-reader summary.
 *
 * The telemetry is derived ONCE here, once per animation frame, through
 * `useHudInstruments`, and each instrument receives its slice of that one
 * reading as props. Only this layer re-renders on telemetry; the cockpit root
 * and the other widgets do not, and a memoised instrument whose inputs did
 * not change does not either.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useHudInstruments } from "@/hooks/use-hud-instruments";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useCockpitStore, type AltitudeReference } from "@/stores/cockpit-store";
import { AttitudeIndicator } from "@/components/cockpit/AttitudeIndicator";
import { AltTape, SpeedTape, VerticalSpeedIndicator } from "@/components/cockpit/Tapes";
import { HeadingTape } from "@/components/cockpit/hud/HeadingTape";
import { WindIndicator } from "@/components/cockpit/hud/WindIndicator";
import { HudReadouts } from "@/components/cockpit/hud/HudReadouts";
import { HudSummary } from "@/components/cockpit/hud/HudSummary";

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

export function HudLayer() {
  const t = useTranslations("cockpit.hud");
  const reading = useHudInstruments();
  const { vehicleClass } = useFirmwareCapabilities();
  const altitudeRef: AltitudeReference =
    useCockpitStore((s) => s.altitudeRef) === "msl" ? "msl" : "rel";
  const setAltitudeRef = useCockpitStore((s) => s.setAltitudeRef);

  // Airspeed only means something on a wing; on a multirotor VFR_HUD airspeed
  // is a ground-speed echo or a stray probe, so the tape stays on ground speed.
  const fixedWing = vehicleClass === "plane" || vehicleClass === "vtol";
  const useAirspeed = fixedWing && reading.airspeed !== null;
  const speed = useAirspeed ? reading.airspeed : reading.speedMps;
  const speedLabel = useAirspeed ? t("ias") : t("gs");
  const alt = altitudeRef === "msl" ? reading.altMsl : reading.alt;
  const refLabel = altitudeRef === "msl" ? t("msl") : t("rel");

  const cardinals = useMemo(
    () => [t("cardN"), t("cardE"), t("cardS"), t("cardW")] as const,
    [t],
  );

  const toggle = useMemo(() => {
    const next: AltitudeReference = altitudeRef === "msl" ? "rel" : "msl";
    return (
      <AltRefToggle
        altitudeRef={altitudeRef}
        label={refLabel}
        ariaLabel={t("altRefToggle", {
          ref: refLabel,
          next: next === "msl" ? t("msl") : t("rel"),
        })}
        onToggle={() => setAltitudeRef(next)}
      />
    );
  }, [altitudeRef, refLabel, setAltitudeRef, t]);

  return (
    <div className="hud-layer" data-testid="hud-layer">
      <AttitudeIndicator
        pitch={reading.pitch}
        roll={reading.roll}
        flightPath={reading.flightPath}
        attFlagLabel={t("attFlag")}
      />
      <HeadingTape
        heading={reading.heading}
        homeBearing={reading.homeBearing}
        cardinals={cardinals}
        homeLabel={t("homeMark")}
      />
      <SpeedTape value={speed} caption={speedLabel} />
      <AltTape value={alt} caption={`${t("alt")} ${refLabel}`} refToggle={toggle} />
      <VerticalSpeedIndicator value={reading.climb} caption={t("vs")} />
      <WindIndicator wind={reading.wind} heading={reading.heading} label={t("wind")} />
      <HudReadouts
        speed={speed}
        speedLabel={speedLabel}
        alt={alt}
        altLabel={`${t("alt")} ${refLabel}`}
        climb={reading.climb}
        climbLabel={t("vs")}
        refToggle={toggle}
      />
      <HudSummary reading={reading} speed={speed} alt={alt} altitudeRef={altitudeRef} />
    </div>
  );
}
