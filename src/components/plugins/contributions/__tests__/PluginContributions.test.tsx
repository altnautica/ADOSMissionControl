/**
 * @license GPL-3.0-only
 *
 * The install pop-up "Adds to Mission Control" block must recognise every GCS
 * slot the manifest can declare — including a `settings.section` panel and a
 * `mission.template` panel — so a plugin whose only contribution is a settings
 * panel does not render an empty block.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { PluginContributions } from "../PluginContributions";
import type { InstallManifestSummary } from "../../install-dialog/types";

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

function manifest(
  over: Partial<InstallManifestSummary>,
): InstallManifestSummary {
  return {
    pluginId: "com.example.settings",
    version: "1.0.0",
    name: "Example",
    halves: ["gcs"],
    signatureState: "unsigned",
    trustSignals: [],
    permissions: [],
    ...over,
  };
}

describe("PluginContributions", () => {
  it("renders + counts a settings.section-only plugin", () => {
    render(
      wrap(
        <PluginContributions
          manifest={manifest({
            contributesSlots: [
              { slot: "settings.section", panelId: "pod-settings", title: "Pod settings" },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText("Adds to Mission Control")).toBeInTheDocument();
    expect(screen.getByText("pod-settings")).toBeInTheDocument();
  });

  it("renders a mission.template slot panel", () => {
    render(
      wrap(
        <PluginContributions
          manifest={manifest({
            contributesSlots: [
              { slot: "mission.template", panelId: "grid-scan", title: "Grid scan" },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText("Adds to Mission Control")).toBeInTheDocument();
    expect(screen.getByText("grid-scan")).toBeInTheDocument();
  });

  it("renders nothing when the plugin contributes no recognized surface", () => {
    const { container } = render(
      wrap(<PluginContributions manifest={manifest({})} />),
    );
    expect(container.firstChild).toBeNull();
  });
});
