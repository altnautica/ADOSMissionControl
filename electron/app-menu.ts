/**
 * The desktop application menu.
 *
 * Without one Electron shows its stock "File Edit View Window" bar, whose View
 * menu carries developer tools in the packaged app. This keeps the editing
 * shortcuts (copy, paste, undo), zoom and full screen, and offers reload and
 * developer tools only in an unpackaged build.
 *
 * @license GPL-3.0-only
 */

import type { MenuItemConstructorOptions } from "electron";

export function buildAppMenuTemplate(
  isPackaged: boolean,
  platform: NodeJS.Platform,
): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions[] = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (!isPackaged) {
    view.push({ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" });
  }

  const template: MenuItemConstructorOptions[] = [];
  if (platform === "darwin") template.push({ role: "appMenu" });
  template.push(
    { role: "fileMenu" },
    { role: "editMenu" },
    { label: "View", submenu: view },
    { role: "windowMenu" },
  );
  return template;
}
