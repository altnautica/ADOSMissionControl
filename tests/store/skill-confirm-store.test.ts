/**
 * Tests for the skill-confirm store seam: a request returns a promise the
 * dispatcher awaits, resolvePending settles it, and a second request cancels
 * the prior one (resolving it false) so two dialogs never stack.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import type { ConfirmPolicy } from "@/lib/skills/types";

const POLICY: ConfirmPolicy = {
  title: "t",
  message: "m",
  confirmLabel: "c",
  variant: "primary",
  gesture: "hold",
};

describe("skill-confirm-store", () => {
  beforeEach(() => {
    useSkillConfirmStore.setState({ pending: null, _nextId: 1 });
  });

  it("requests a confirm and resolves it true", async () => {
    const store = useSkillConfirmStore.getState();
    const promise = store.request(POLICY);
    expect(useSkillConfirmStore.getState().pending).not.toBeNull();
    useSkillConfirmStore.getState().resolvePending(true);
    await expect(promise).resolves.toBe(true);
    expect(useSkillConfirmStore.getState().pending).toBeNull();
  });

  it("resolves false on cancel", async () => {
    const promise = useSkillConfirmStore.getState().request(POLICY);
    useSkillConfirmStore.getState().resolvePending(false);
    await expect(promise).resolves.toBe(false);
  });

  it("cancels a prior pending request when a new one arrives", async () => {
    const first = useSkillConfirmStore.getState().request(POLICY);
    const second = useSkillConfirmStore.getState().request({
      ...POLICY,
      title: "second",
    });
    // The first promise resolves false (cancelled), the second stays pending.
    await expect(first).resolves.toBe(false);
    expect(useSkillConfirmStore.getState().pending?.policy.title).toBe("second");
    useSkillConfirmStore.getState().resolvePending(true);
    await expect(second).resolves.toBe(true);
  });

  it("assigns monotonic request ids", async () => {
    const p1 = useSkillConfirmStore.getState().request(POLICY);
    const firstId = useSkillConfirmStore.getState().pending?.id;
    useSkillConfirmStore.getState().resolvePending(true);
    await p1;
    useSkillConfirmStore.getState().request(POLICY);
    const secondId = useSkillConfirmStore.getState().pending?.id;
    expect(secondId).toBe((firstId ?? 0) + 1);
  });
});
