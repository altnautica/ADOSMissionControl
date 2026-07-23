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
import { screen } from "@testing-library/react";
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

describe("CloudPage backend URL", () => {
  it("binds the backend row to server.self_hosted.url in self-hosted mode", () => {
    renderWithIntl(
      <CloudPage
        config={{
          server: {
            mode: "self_hosted",
            self_hosted: { url: "https://convex.myco.example" },
            cloud: { url: "https://convex-site.altnautica.com" },
          },
        }}
      />,
    );

    expect(screen.getByText("Backend URL")).toBeTruthy();
    expect(screen.getByText("https://convex.myco.example")).toBeTruthy();
    // Never the wrong-mode URL.
    expect(
      screen.queryByText("https://convex-site.altnautica.com"),
    ).toBeNull();
  });

  it("binds the backend row to server.cloud.url in cloud mode", () => {
    renderWithIntl(
      <CloudPage
        config={{
          server: {
            mode: "cloud",
            self_hosted: { url: "" },
            cloud: { url: "https://convex-site.altnautica.com" },
          },
        }}
      />,
    );

    expect(
      screen.getByText("https://convex-site.altnautica.com"),
    ).toBeTruthy();
  });

  it("shows no backend row in local mode (there is no backend)", () => {
    renderWithIntl(
      <CloudPage
        config={{
          server: {
            mode: "local",
            self_hosted: { url: "" },
            cloud: { url: "https://convex-site.altnautica.com" },
          },
        }}
      />,
    );

    expect(screen.queryByText("Backend URL")).toBeNull();
    expect(
      screen.queryByText("https://convex-site.altnautica.com"),
    ).toBeNull();
  });
});
