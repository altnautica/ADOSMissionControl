/**
 * Tests for the core Settings pages (Profile / Cloud / Advanced).
 *
 * The Advanced page renders the board override read-only: it is file-sourced
 * (`/etc/ados/board_override`, injected onto GET only) and is not a writable
 * Pydantic config field, so the agent rejects a PUT to `agent.board_override`
 * with "Key not found". The page must therefore never present it as an
 * editable control that silently fails every write.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../helpers/intl-wrapper";

import {
  AdvancedPage,
  CloudPage,
} from "@/components/command/settings/CorePages";

describe("AdvancedPage board override", () => {
  it("renders the forced board slug read-only, not in an editable input", () => {
    renderWithIntl(
      <AdvancedPage
        config={{
          logging: { level: "info" },
          agent: { board_override: "rock-5c-lite" },
        }}
        readOnly={false}
        setValue={vi.fn(async () => {})}
      />,
    );

    // The slug renders as a value the operator can read.
    expect(screen.getByText("rock-5c-lite")).toBeTruthy();
    // ...but never inside an editable input (no write control that would be
    // rejected by the agent as "Key not found").
    expect(screen.queryByDisplayValue("rock-5c-lite")).toBeNull();
    expect(screen.getByText("Board override")).toBeTruthy();
  });

  it("shows auto-detect when no board override is set", () => {
    renderWithIntl(
      <AdvancedPage
        config={{ logging: { level: "info" }, agent: { board_override: "" } }}
        readOnly={false}
        setValue={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText("Auto-detect")).toBeTruthy();
  });
});

function renderCloud(config: Record<string, unknown>) {
  const setValue = vi.fn(async () => {});
  renderWithIntl(
    <CloudPage config={config} readOnly={false} setValue={setValue} />,
  );
  return { setValue };
}

describe("CloudPage backend URL", () => {
  it("binds the backend row to server.self_hosted.url in self-hosted mode", () => {
    renderCloud({
      server: {
        mode: "self_hosted",
        self_hosted: { url: "https://convex.myco.example" },
        cloud: { url: "https://convex-site.altnautica.com" },
      },
    });

    expect(screen.getByText("Backend URL")).toBeTruthy();
    expect(screen.getByText("https://convex.myco.example")).toBeTruthy();
    // Never the wrong-mode URL.
    expect(
      screen.queryByText("https://convex-site.altnautica.com"),
    ).toBeNull();
  });

  it("binds the backend row to server.cloud.url in cloud mode", () => {
    renderCloud({
      server: {
        mode: "cloud",
        self_hosted: { url: "" },
        cloud: { url: "https://convex-site.altnautica.com" },
      },
    });

    expect(
      screen.getByText("https://convex-site.altnautica.com"),
    ).toBeTruthy();
  });

  it("shows no backend row in local mode (there is no backend)", () => {
    renderCloud({
      server: {
        mode: "local",
        self_hosted: { url: "" },
        cloud: { url: "https://convex-site.altnautica.com" },
      },
    });

    expect(screen.queryByText("Backend URL")).toBeNull();
    expect(
      screen.queryByText("https://convex-site.altnautica.com"),
    ).toBeNull();
  });
});

describe("CloudPage remote access", () => {
  it("exposes editable remote-access controls wired to real keys", async () => {
    const { setValue } = renderCloud({
      server: { mode: "local" },
      remote_access: { provider: "none", cloudflare: { enabled: false } },
    });

    // The provider control renders (its home for the remote_access block).
    expect(screen.getByText("Remote access")).toBeTruthy();
    // The tunnel-enable toggle writes to the real config key with read-back.
    fireEvent.click(screen.getByText("Cloudflare tunnel active"));
    await waitFor(() =>
      expect(setValue).toHaveBeenCalledWith(
        "remote_access.cloudflare.enabled",
        "true",
      ),
    );
  });

  it("shows the published tunnel endpoints read-only when present", () => {
    renderCloud({
      server: { mode: "local" },
      remote_access: {
        provider: "cloudflare",
        cloudflare: {
          enabled: true,
          setup_url: "https://setup.example.trycloudflare.com",
          api_url: "",
          video_whep_url: "",
          mavlink_ws_url: "",
        },
      },
    });

    expect(screen.getByText("Setup URL")).toBeTruthy();
    expect(
      screen.getByText("https://setup.example.trycloudflare.com"),
    ).toBeTruthy();
    // Endpoints the node has not published stay hidden (not a blank row).
    expect(screen.queryByText("API URL")).toBeNull();
  });
});
