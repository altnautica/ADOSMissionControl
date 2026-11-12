import { describe, it, expect, beforeEach } from "vitest";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";

describe("prearm-buffer-store", () => {
  beforeEach(() => {
    usePrearmBufferStore.setState({ buffers: {} });
  });

  describe("STATUSTEXT buffer", () => {
    it("filters to PreArm: prefix and caps at 20 lines", () => {
      const { push, peek } = usePrearmBufferStore.getState();
      for (let i = 0; i < 25; i++) {
        push("drone-1", `PreArm: line ${i}`);
      }
      push("drone-1", "ignored: not a prearm line");
      const lines = peek("drone-1");
      expect(lines).toHaveLength(20);
      expect(lines[0]).toBe("PreArm: line 5");
      expect(lines[19]).toBe("PreArm: line 24");
    });
  });
});
