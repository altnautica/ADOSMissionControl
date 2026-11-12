/**
 * @module controllers-page-empty.test
 * @description The Controllers page shows a translated empty state when the
 * ground station reports no controllers: no raw message key and no untranslated
 * literal stands in for it.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../../locales/en.json";

vi.mock("@/components/hardware/ControllersSection", () => ({ ControllersSection: () => null }));
vi.mock("@/components/config/SkillBindingsSection", () => ({ SkillBindingsSection: () => null }));
vi.mock("@/components/config/ControlsSettings", () => ({ ControlsSettings: () => null }));
vi.mock("@/components/hardware/BluetoothPairModal", () => ({ BluetoothPairModal: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/api/ground-station-api", () => ({ groundStationApiFromAgent: () => null }));
vi.mock("@/lib/skills", () => ({ registerBuiltins: () => {} }));

import InputDevicesPage from "@/app/config/input/page";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

describe("Controllers page empty state", () => {
  beforeEach(() => {
    useAgentConnectionStore.setState({ agentUrl: "http://agent.local:8080" });
  });

  it("renders the translated empty state when the ground station has no controllers", () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <InputDevicesPage />
      </NextIntlClientProvider>,
    );
    const empty = screen.getByTestId("ground-station-controllers-empty");
    expect(empty.textContent).toContain(en.inputDevices.groundStationEmpty);
    expect(empty.textContent).toContain(en.inputDevices.groundStationEmptyHint);
    expect(empty.textContent).not.toMatch(/inputDevices\.|groundStationEmpty/);
  });
});
