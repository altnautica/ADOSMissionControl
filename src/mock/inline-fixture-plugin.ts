/**
 * @module mock/inline-fixture-plugin
 * @description Demo-mode fixture for the inline plugin host: one in-memory
 * `InlinePluginModule` contributing a `node.agent.page`, so the inline mount
 * path (host API, ctx bridge, theme push, disposer) is observable in
 * `npm run demo` without a signed extension. It never loads through the trust
 * gate; demo mode hands the module object straight to the host.
 *
 * @license GPL-3.0-only
 */

import type { InlinePluginModule } from "@/lib/plugins/inline-host-types";

export const DEMO_INLINE_FIXTURE_PLUGIN_ID = "com.example.inline-fixture";
export const DEMO_INLINE_FIXTURE_PANEL_ID = "hello";

/** Renders plugin and node identity plus the live theme-var count, and
 * records a mount/unmount pair so a remount is visible. */
export const DEMO_INLINE_FIXTURE_MODULE: InlinePluginModule = {
  mount(root, host) {
    const card = document.createElement("div");
    card.className =
      "m-3 rounded border border-border-default bg-bg-secondary p-3 text-xs text-text-primary";
    card.dataset.inlineFixture = host.plugin.panelId;
    const title = document.createElement("div");
    title.className = "mb-2 text-sm font-medium";
    title.textContent = "Inline Fixture";
    const lines = document.createElement("div");
    lines.className = "space-y-1 font-mono text-text-secondary";
    const theme = document.createElement("div");
    theme.textContent = "theme vars: waiting";
    for (const text of [
      `plugin ${host.plugin.id}@${host.plugin.version} (${host.plugin.signerId})`,
      `node ${host.node.deviceId ?? "none"} · ${host.node.profile ?? "unknown"}`,
      `paired nodes: ${host.nodes.list().length}`,
    ]) {
      const line = document.createElement("div");
      line.textContent = text;
      lines.append(line);
    }
    lines.append(theme);
    card.append(title, lines);
    root.append(card);
    const offTheme = host.ctx.theme.onChange((vars) => {
      theme.textContent = `theme vars: ${Object.keys(vars).length}`;
    });
    return () => {
      offTheme();
      card.remove();
    };
  },
};
