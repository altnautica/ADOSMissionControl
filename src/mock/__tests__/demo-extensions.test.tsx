/**
 * The demo's first-party extensions mirror their newest published release:
 * catalog rows carry the release manifest and signed asset; installs, tabs,
 * parameters, skills, target actions and assistant tools come from the same
 * manifest; and the demo parameter panel shows the extension's own words.
 *
 * @license GPL-3.0-only
 */

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";
import {
  FOLLOW_ME,
  GIMBAL,
  SIYI_POD,
  THERMAL,
  VISION_NAV,
  WORLD_ENGINE_RELEASE,
  type DemoExtensionRelease,
} from "@/mock/extension-manifests";
import { DEMO_REGISTRY_ENTRIES } from "@/mock/first-party-registry";
import { getDemoMcpPlugins } from "@/mock/mock-mcp-plugins";
import { getDemoDroneSkillContributions } from "@/mock/mock-plugin-skills";
import {
  getDemoDronePluginContributions,
  getDemoDronePluginInstalls,
  getDemoDroneTargetActions,
} from "@/mock/mock-plugins";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("@/components/vision/ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { PluginParametersPanel } from "@/components/plugins/parameters/PluginParametersPanel";
import enMessages from "../../../locales/en.json";

const RELEASES: DemoExtensionRelease[] = [SIYI_POD, FOLLOW_ME, GIMBAL, THERMAL, VISION_NAV];
const DRONES = ["alpha-1", "charlie-3", "delta-4"];
const parsed = (r: DemoExtensionRelease) => parseManifestYaml(r.manifestYaml);
const installsOf = (pluginId: string) =>
  DRONES.flatMap(getDemoDronePluginInstalls).filter((i) => i.pluginId === pluginId);

describe("demo catalog", () => {
  it("lists every first-party extension at its newest published release", () => {
    for (const release of [...RELEASES, WORLD_ENGINE_RELEASE]) {
      const m = parsed(release);
      const entry = DEMO_REGISTRY_ENTRIES.find((e) => e.row.plugin_id === m.pluginId);
      expect(entry, m.pluginId).toBeTruthy();
      expect(entry!.manifestYaml).toBe(release.manifestYaml);
      expect(entry!.row.latest_version).toBe(m.version);
      expect(entry!.downloadUrl).toBe(release.downloadUrl);
      expect(entry!.archiveSha256).toBe(release.archiveSha256);
      expect(entry!.archiveSizeBytes).toBe(release.archiveSizeBytes);
    }
  });
});

describe("demo installs", () => {
  it("carry each release's id, name, version and tab", () => {
    for (const release of RELEASES) {
      const m = parsed(release);
      const installs = installsOf(m.pluginId);
      expect(installs.length, m.pluginId).toBeGreaterThan(0);
      const tab = m.contributesTabs?.[0];
      for (const install of installs) {
        expect(install.name).toBe(m.name);
        expect(install.version).toBe(m.version);
        expect(install.firstParty).toBe(true);
        expect(install.droneDetailTabPanelId).toBe(tab?.panelId);
        expect(install.droneDetailTabTitle).toBe(tab?.title);
        expect(install.droneDetailTabIcon).toBe(tab?.icon);
        expect(install.droneDetailTabOrder).toBe(tab?.order);
        expect(install.parameters ?? []).toEqual(m.contributesParameters ?? []);
      }
    }
  });

  it("offers no extension the catalog does not publish", () => {
    const ids = DRONES.flatMap(getDemoDronePluginInstalls).map((i) => i.pluginId);
    expect(ids).not.toContain("com.flir.thermal");
    expect(ids).not.toContain("com.altnautica.gimbal-v2");
  });

  it("gives every drone-detail tab a body", () => {
    for (const drone of DRONES) {
      for (const tab of getDemoDronePluginContributions(drone)) {
        const hasInlineBody = tab.pluginId === "com.altnautica.vision-nav";
        expect(hasInlineBody || tab.parameters.length > 0, `${drone} ${tab.panelId}`).toBe(true);
      }
    }
  });
});

describe("demo skills and target actions", () => {
  it("serves skills only from a running install of the same extension on that drone", () => {
    for (const drone of DRONES) {
      const running = getDemoDronePluginInstalls(drone).filter((i) => i.status === "running");
      for (const skill of getDemoDroneSkillContributions(drone)) {
        const install = running.find((i) => i.installId === skill.installId);
        expect(install?.pluginId, `${drone} ${skill.localId}`).toBe(skill.pluginId);
      }
    }
    const siyiSkills = getDemoDroneSkillContributions("alpha-1").filter(
      (s) => s.pluginId === "com.altnautica.siyi-pod",
    );
    expect(siyiSkills.length).toBeGreaterThan(0);
  });

  it("serves exactly the skills each manifest declares, with words for labels", () => {
    const skills = DRONES.flatMap(getDemoDroneSkillContributions);
    for (const release of [SIYI_POD, FOLLOW_ME]) {
      const m = parsed(release);
      const ids = skills.filter((s) => s.pluginId === m.pluginId).map((s) => s.localId);
      expect(ids.sort()).toEqual((m.contributesSkills ?? []).map((s) => s.id).sort());
    }
    for (const s of skills) expect(s.label).not.toMatch(/^skill\./);
    const follow = skills.find((s) => s.localId === "follow-me");
    expect(follow?.params ?? []).toEqual([]);
  });

  it("offers the follow-me target actions from its running install", () => {
    const declared = (parsed(FOLLOW_ME).contributesTargetActions ?? []).map((a) => a.id);
    const followInstalls = installsOf("com.altnautica.follow-me").filter((i) => i.status === "running");
    for (const drone of DRONES) {
      const actions = getDemoDroneTargetActions(drone).filter(
        (a) => a.pluginId === "com.altnautica.follow-me",
      );
      const install = followInstalls.find((i) => i.agentId === drone);
      if (!install) {
        expect(actions).toEqual([]);
        continue;
      }
      expect(actions.map((a) => a.localId).sort()).toEqual([...declared].sort());
      for (const a of actions) expect(a.installId).toBe(install.installId);
    }
  });
});

describe("demo assistant tools", () => {
  it("mirror the follow-me release's tools, permissions and version", () => {
    const m = parsed(FOLLOW_ME);
    const view = getDemoMcpPlugins().find((p) => p.pluginId === m.pluginId);
    expect(view?.version).toBe(m.version);
    expect(view?.tools.map((t) => t.name)).toEqual((m.contributesTools ?? []).map((t) => t.name));
    expect(view?.grantedCaps).toEqual(
      m.permissions.filter((p) => p.half === "agent").map((p) => p.id),
    );
    expect(view?.installedOn).toEqual(installsOf(m.pluginId).map((i) => i.agentId));
  });

  it("lists only extensions that declare tools, under their real ids", () => {
    const ids = getDemoMcpPlugins().map((p) => p.pluginId);
    expect(ids).not.toContain("com.altnautica.thermal-cam");
    expect(ids).not.toContain(parsed(THERMAL).pluginId);
    expect(ids).toEqual(expect.arrayContaining([parsed(SIYI_POD).pluginId, parsed(GIMBAL).pluginId]));
  });
});

describe("demo parameter labels", () => {
  beforeEach(() => {
    useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  });
  afterEach(() => {
    useSettingsStore.setState({ demoMode: false });
  });

  it("shows the extension's words, not its locale keys", async () => {
    const install = installsOf("com.altnautica.follow-me")[0];
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PluginParametersPanel
          droneId={install.agentId}
          pluginId={install.pluginId}
          parameters={install.parameters ?? []}
        />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText("Follow distance (m)")).toBeTruthy();
    expect(screen.queryByText("settings.followDistance")).toBeNull();
  });
});
