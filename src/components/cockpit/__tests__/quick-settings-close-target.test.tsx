/**
 * @license GPL-3.0-only
 *
 * The quick-settings drawer's close button is a touch-size hit area
 * (`layout.json` `touch_target.min`, 48 px = Tailwind `h-12 w-12`), with the
 * smaller bordered box drawn inside it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";

vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => undefined }));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) => sel({ isAuthenticated: false }),
}));
vi.mock("@/hooks/use-local-agent-plugins", () => ({ useLocalAgentPlugins: () => null }));
vi.mock("@/hooks/use-plugin-contributions", () => ({ usePluginContributions: () => [] }));
vi.mock("@/components/vision/ModelPicker", () => ({ ModelPicker: () => null }));

import { CockpitQuickSettings } from "../CockpitQuickSettings";

afterEach(cleanup);

describe("quick-settings drawer close", () => {
  it("is a 48 px hit area that closes the drawer", () => {
    expect(layoutSpec.touch_target.min).toBe(48);
    const onClose = vi.fn();
    renderWithIntl(<CockpitQuickSettings droneId="node:abc" onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button");
    expect(close.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-12", "w-12"]));
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
