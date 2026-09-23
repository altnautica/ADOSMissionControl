/**
 * @license GPL-3.0-only
 *
 * Unit tests for the rich PermissionsSection consent block. Covers
 * grouping by category, Sensitive pill on high/critical-risk rows,
 * Required pill on required rows, Toggle on optional rows, and the
 * help-icon tooltip surfacing the catalog description.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { PermissionsSection } from "../sections/PermissionsSection";
import type { InstallManifestSummary } from "../types";

vi.mock("lucide-react", async () => {
  const actual = await vi.importActual<typeof import("lucide-react")>(
    "lucide-react",
  );
  return actual;
});

function wrap(node: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

const baseManifest: InstallManifestSummary = {
  pluginId: "altnautica.vision-nav",
  version: "0.2.4",
  name: "Vision Nav",
  halves: ["agent"],
  signatureState: "unsigned",
  trustSignals: [],
  permissions: [
    {
      id: "hardware.usb.uvc",
      required: true,
      label: "Read frames from USB UVC cameras",
      description: "Open USB video capture devices for vision input.",
      category: "hardware",
      risk: "medium",
    },
    {
      id: "hardware.camera.csi",
      required: true,
      label: "Read frames from CSI MIPI cameras",
      description: "Open MIPI CSI cameras via V4L2.",
      category: "hardware",
      risk: "medium",
    },
    {
      id: "mavlink.write",
      required: true,
      label: "Send MAVLink commands to flight controller",
      description: "Inject MAVLink messages into the FC link.",
      category: "flight_control",
      risk: "high",
    },
    {
      id: "process.spawn",
      required: true,
      label: "Spawn subprocesses on the agent host",
      description: "Create child processes from the agent.",
      category: "compute_process",
      risk: "critical",
    },
    {
      id: "network.outbound",
      required: false,
      label: "Publish data to the cloud relay",
      description: "Push messages to the cloud bridge.",
      category: "data_network",
      risk: "low",
    },
  ],
};

describe("PermissionsSection", () => {
  it("renders each category with its row count", () => {
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("Flight Control")).toBeInTheDocument();
    expect(screen.getByText("Compute & Process")).toBeInTheDocument();
    expect(screen.getByText("Data & Network")).toBeInTheDocument();
    // Counts appear next to category headers.
    expect(screen.getByText("(2)")).toBeInTheDocument(); // hardware
    // Three categories with 1 row each.
    expect(screen.getAllByText("(1)").length).toBe(3);
  });

  it("renders Sensitive pill on high/critical-risk rows", () => {
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    // mavlink.write (high) + process.spawn (critical) = 2 sensitive pills
    expect(screen.getAllByText("Sensitive").length).toBe(2);
  });

  it("renders Required pill on required rows", () => {
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    // 4 required rows
    expect(screen.getAllByText("Required").length).toBe(4);
  });

  it("renders a Toggle on optional rows (not a Required pill)", () => {
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    // network.outbound is the only optional row.
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBe(1);
    // The optional row is not part of the Required count.
    expect(screen.getAllByText("Required").length).toBe(4);
  });

  it("calls onToggle when the optional toggle is clicked", () => {
    const onToggle = vi.fn();
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={onToggle}
        />,
      ),
    );
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);
    expect(onToggle).toHaveBeenCalledWith("network.outbound", false);
  });

  it("surfaces the permission description as the help-icon tooltip", () => {
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    // The help icons carry an aria-label keyed off the row's label; the
    // tooltip itself becomes visible on hover. Assert the help-icon
    // hosts exist for each row that carries a description or risk_reason.
    const helpIcons = screen.getAllByLabelText(/^Help: /);
    // 5 rows × 1 help icon each
    expect(helpIcons.length).toBe(5);
    // Hover the first help icon -> tooltip body appears. The row body
    // already renders the description inline as line 2, so the same
    // text shows up twice when hovered (once in the row, once in the
    // portaled tooltip). Use getAllByText to handle the duplication.
    const firstHelp = helpIcons[0];
    fireEvent.mouseEnter(firstHelp.parentElement!);
    const matches = screen.getAllByText(
      "Open USB video capture devices for vision input.",
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // The portaled tooltip element carries role=tooltip; the inline
    // body in the row does not.
    expect(
      matches.some((el) => el.closest("[role=tooltip]") !== null),
    ).toBe(true);
  });

  it("renders the section title with required count only when no optional perms", () => {
    const manifest: InstallManifestSummary = {
      ...baseManifest,
      permissions: baseManifest.permissions.filter((p) => p.required),
    };
    render(
      wrap(
        <PermissionsSection
          manifest={manifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Permissions (4 required)")).toBeInTheDocument();
  });

  it("renders the section title with required + optional split when optional perms exist", () => {
    render(
      wrap(
        <PermissionsSection
          manifest={baseManifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    expect(
      screen.getByText("Permissions (4 required, 1 optional)"),
    ).toBeInTheDocument();
  });

  it("renders unknown-label rows with the id as line 1 (no second line)", () => {
    const manifest: InstallManifestSummary = {
      ...baseManifest,
      permissions: [
        {
          id: "unknown.cap.foo",
          required: true,
        },
      ],
    };
    render(
      wrap(
        <PermissionsSection
          manifest={manifest}
          granted={new Set()}
          onToggle={() => {}}
        />,
      ),
    );
    expect(screen.getByText("unknown.cap.foo")).toBeInTheDocument();
    // Only one rendering of the id (no twin line).
    expect(screen.getAllByText("unknown.cap.foo").length).toBe(1);
  });
});
