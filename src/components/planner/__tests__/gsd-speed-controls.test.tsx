/**
 * @license GPL-3.0-only
 * GsdSpeedControls: a target GSD writes the solved altitude into the survey
 * config, and an over-speed survey shows the motion-blur warning.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { GsdSpeedControls } from "@/components/planner/GsdSpeedControls";
import { usePatternStore } from "@/stores/pattern-store";
import { CAMERA_PROFILES } from "@/lib/patterns/gsd-calculator";

// 4/3-type 21 MP · 12.3 mm: sensorWidth 17.3, focalLength 12.29, imageWidth 5280.
const camera = CAMERA_PROFILES.find((c) => c.name === "4/3-type 21 MP · 12.3 mm")!;

beforeEach(() => {
  usePatternStore.setState({ surveyConfig: {} });
});

describe("GsdSpeedControls", () => {
  it("renders nothing without a camera", () => {
    const { container } = render(
      <GsdSpeedControls camera={undefined} sidelapPct={60} frontlapPct={70} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("solves altitude from a target GSD and writes it to the survey config", () => {
    render(<GsdSpeedControls camera={camera} sidelapPct={60} frontlapPct={70} />);
    const field = screen.getByLabelText("targetGsd");
    fireEvent.change(field, { target: { value: "2" } });
    // Typing edits a draft; nothing reaches the store until the field commits.
    expect(usePatternStore.getState().surveyConfig.altitude).toBeUndefined();
    fireEvent.blur(field);
    // altitude = (2/100) * 12.29 * 5280 / 17.3 ≈ 75
    expect(usePatternStore.getState().surveyConfig.altitude).toBe(75);
  });

  it("warns when the survey speed exceeds the motion-blur-safe speed", () => {
    usePatternStore.setState({ surveyConfig: { altitude: 50, speed: 20 } });
    render(<GsdSpeedControls camera={camera} sidelapPct={60} frontlapPct={70} />);
    expect(screen.getByText("motionBlur")).toBeInTheDocument();
  });

  it("shows no blur warning at a safe survey speed", () => {
    usePatternStore.setState({ surveyConfig: { altitude: 50, speed: 5 } });
    render(<GsdSpeedControls camera={camera} sidelapPct={60} frontlapPct={70} />);
    expect(screen.queryByText("motionBlur")).toBeNull();
  });
});
