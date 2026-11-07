import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";

import { safeRegionHeight, useCockpitContainerLayout } from "@/hooks/use-cockpit-width-class";
import { isKioskSearch, widthClassFor } from "@/lib/cockpit/width-class";

describe("widthClassFor", () => {
  it("splits at 600, 840 and 1600 px", () => {
    expect(widthClassFor(390, false)).toBe("compact");
    expect(widthClassFor(599, false)).toBe("compact");
    expect(widthClassFor(600, false)).toBe("medium");
    expect(widthClassFor(839, false)).toBe("medium");
    expect(widthClassFor(840, false)).toBe("expanded");
    expect(widthClassFor(1599, false)).toBe("expanded");
    expect(widthClassFor(1600, false)).toBe("tv");
  });

  it("is tv on a kiosk surface at any width", () => {
    expect(widthClassFor(390, true)).toBe("tv");
    expect(isKioskSearch("?kiosk=1")).toBe(true);
    expect(isKioskSearch("?kiosk=0")).toBe(false);
    expect(isKioskSearch("")).toBe(false);
  });

  it("subtracts the band and the Skill Bar clearance from the safe height", () => {
    expect(safeRegionHeight({ widthClass: "compact", width: 390, height: 500 })).toBe(348);
    expect(safeRegionHeight({ widthClass: "tv", width: 1920, height: 1080 })).toBe(900);
  });
});

function Probe({ width }: { width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const layout = useCockpitContainerLayout(ref);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) el.getBoundingClientRect = () => ({ width, height: 400 }) as DOMRect;
      }}
      data-testid="probe"
      data-class={layout.widthClass}
    />
  );
}

describe("useCockpitContainerLayout", () => {
  it("measures the container, not the viewport", () => {
    const { getByTestId } = render(<Probe width={700} />);
    expect(getByTestId("probe").getAttribute("data-class")).toBe("medium");
  });
});
