/**
 * The desktop app menu: no developer tools in a packaged build.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildAppMenuTemplate } from "../../../electron/app-menu";

function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : []),
  ]);
}

describe("app menu", () => {
  it("leaves developer tools and reload out of a packaged build", () => {
    const r = roles(buildAppMenuTemplate(true, "linux"));
    expect(r).not.toContain("toggleDevTools");
    expect(r).not.toContain("reload");
    expect(r).toContain("editMenu");
  });

  it("offers developer tools in an unpackaged build", () => {
    expect(roles(buildAppMenuTemplate(false, "linux"))).toContain("toggleDevTools");
  });

  it("adds the app menu on macOS only", () => {
    expect(roles(buildAppMenuTemplate(true, "darwin"))[0]).toBe("appMenu");
    expect(roles(buildAppMenuTemplate(true, "win32"))).not.toContain("appMenu");
  });
});
