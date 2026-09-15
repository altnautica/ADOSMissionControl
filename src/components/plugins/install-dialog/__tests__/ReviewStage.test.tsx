/**
 * @license GPL-3.0-only
 *
 * Render tests for the single-page review stage. Covers the identity
 * header, the rich permissions consent block, the install button
 * label, the disabled state when the host is incompatible, and the
 * multi-paragraph description renderer.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, fireEvent, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { ReviewStage } from "../sections/ReviewStage";
import type { InstallManifestSummary } from "../types";
import type { CompatibilityResult } from "../check-compatibility";

vi.mock("lucide-react", async () => {
  // Re-export from the real module so every icon name resolves to a
  // valid component without us having to enumerate every glyph the
  // ReviewStage + section files pull in.
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
  version: "0.2.3",
  name: "Vision Nav",
  author: "Altnautica",
  description: "GPS-denied estimator",
  license: "GPL-3.0-or-later",
  halves: ["agent", "gcs"],
  signatureState: "verified",
  signerId: "altnautica-2026-A",
  trustSignals: ["signed", "verified-publisher"],
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
      risk: "high",
    },
    {
      id: "cloud.write",
      required: false,
      label: "Publish data to the cloud relay",
      description: "Push messages to the cloud bridge.",
      category: "data_network",
      risk: "low",
    },
  ],
  features: ["Optical flow estimator", "VIO fusion"],
  hardwareRequirements: { boards: ["rk3582"] },
  resourceImpact: { ramMb: 1024, cpuPercentPeak: 60 },
};

function compat(boardOk: boolean): CompatibilityResult {
  return {
    boardCompatible: boardOk,
    boardReason: boardOk ? undefined : "rpi4b",
    ramOk: true,
    cpuOk: true,
  };
}

describe("ReviewStage", () => {
  it("renders the plugin identity header and target drone", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={
            new Set(["hardware.usb.uvc", "mavlink.write", "process.spawn"])
          }
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Vision Nav")).toBeInTheDocument();
    expect(screen.getByText(/by Altnautica/)).toBeInTheDocument();
    expect(screen.getByText(/Installing to: skynode/)).toBeInTheDocument();
  });

  it("renders the rich permissions consent block with each category", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={
            new Set(["hardware.usb.uvc", "mavlink.write", "process.spawn"])
          }
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    // Each represented category renders a sub-header with its count.
    expect(screen.getByText("Hardware")).toBeInTheDocument();
    expect(screen.getByText("Flight Control")).toBeInTheDocument();
    expect(screen.getByText("Compute & Process")).toBeInTheDocument();
    expect(screen.getByText("Data & Network")).toBeInTheDocument();
    // Plain-language labels reach the DOM.
    expect(
      screen.getByText("Read frames from USB UVC cameras"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Send MAVLink commands to flight controller"),
    ).toBeInTheDocument();
  });

  it("shows Sensitive pill on high-risk rows and Required pill on required rows", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={
            new Set(["hardware.usb.uvc", "mavlink.write", "process.spawn"])
          }
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    // mavlink.write + process.spawn both risk:"high"
    expect(screen.getAllByText("Sensitive").length).toBe(2);
    // 3 required rows
    expect(screen.getAllByText("Required").length).toBe(3);
  });

  it("renders the install button with grants label", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set(["hardware.usb.uvc", "mavlink.write"])}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    expect(
      screen.getByRole("button", { name: /Install — grants 2 permissions/i }),
    ).toBeInTheDocument();
  });

  it("reads 'Install' (never 'grants 0') when nothing is granted", () => {
    render(
      wrap(
        <ReviewStage
          manifest={{ ...baseManifest, halves: ["gcs"] }}
          targetName="Mission Control"
          agentTargetName={null}
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set()}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    // Footer button reads the bare "Install", not "grants 0 permissions".
    expect(
      screen.getByRole("button", { name: /^Install$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/grants 0/i)).toBeNull();
    // The sub-bar pill still counts the full permission surface to review.
    expect(
      screen.getByRole("button", { name: /4 permissions/i }),
    ).toBeInTheDocument();
  });

  it("disables install when the host is incompatible", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rpi4b"
          compatibility={compat(false)}
          granted={new Set(["hardware.usb.uvc"])}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    const btn = screen.getByRole("button", {
      name: /Install — grants 1 permissions/i,
    });
    expect(btn).toBeDisabled();
  });

  it("fires onInstall when the install button is clicked", () => {
    const onInstall = vi.fn();
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set(["hardware.usb.uvc"])}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={onInstall}
        />,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Install — grants 1 permissions/i }),
    );
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("does NOT render a Permissions branch in the sidebar tree", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set()}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    // The sidebar tree previously carried a `Permissions (N)` branch.
    // After the trim it must not appear anywhere on the surface.
    expect(screen.queryByText(/^Permissions \(\d+\)$/)).toBeNull();
  });

  it("shows both destinations for a hybrid installed on a drone", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="skynode"
          agentTargetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set(["hardware.usb.uvc"])}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Agent half")).toBeInTheDocument();
    expect(screen.getByText("GCS half")).toBeInTheDocument();
    // Agent half resolves to the drone; GCS half to this Mission Control.
    expect(screen.getAllByText("skynode").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("this Mission Control")).toBeInTheDocument();
    expect(screen.queryByText(/installs per-drone/)).toBeNull();
  });

  it("flags the agent half as per-drone when a hybrid opens with no drone", () => {
    render(
      wrap(
        <ReviewStage
          manifest={baseManifest}
          targetName="Mission Control"
          agentTargetName={null}
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set(["hardware.usb.uvc"])}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    expect(screen.getByText("Agent half")).toBeInTheDocument();
    expect(screen.getByText(/installs per-drone/)).toBeInTheDocument();
    expect(screen.getByText("GCS half")).toBeInTheDocument();
  });

  it("shows only the GCS destination for a GCS-only plugin", () => {
    render(
      wrap(
        <ReviewStage
          manifest={{ ...baseManifest, halves: ["gcs"] }}
          targetName="Mission Control"
          agentTargetName={null}
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set()}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    expect(screen.queryByText("Agent half")).toBeNull();
    expect(screen.getByText("GCS half")).toBeInTheDocument();
    expect(screen.getByText("this Mission Control")).toBeInTheDocument();
  });

  it("renders multi-paragraph description as separate <p> tags", () => {
    const manifest: InstallManifestSummary = {
      ...baseManifest,
      descriptionLong:
        "First paragraph about what it does.\n\nSecond paragraph about modes.\n\nThird paragraph about fallback.",
    };
    const { container } = render(
      wrap(
        <ReviewStage
          manifest={manifest}
          targetName="skynode"
          boardLabel="rock-5c-lite"
          compatibility={compat(true)}
          granted={new Set()}
          onTogglePermission={() => {}}
          onCancel={() => {}}
          onInstall={() => {}}
        />,
      ),
    );
    // 3 paragraph chunks from descriptionLong, plus 1 short description
    // paragraph rendered first.
    expect(
      screen.getByText("First paragraph about what it does."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Second paragraph about modes."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Third paragraph about fallback."),
    ).toBeInTheDocument();
    // Each paragraph chunk lives in its own <p>.
    const paragraphs = Array.from(
      container.querySelectorAll(".whitespace-pre-line"),
    );
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
  });
});
