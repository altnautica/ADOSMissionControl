import { describe, it, expect, vi } from "vitest";

import {
  allocateCloudLinkId,
  exportCloudKeyBytes,
  getCloudKeyForDrone,
  listMyCloudKeys,
  releaseCloudLinkId,
  removeCloudKey,
  uploadKey,
  type CloudSigningKey,
} from "@/lib/api/signing-cloud-sync";

function fakeClient(overrides: {
  query?: ReturnType<typeof vi.fn>;
  mutation?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    query: overrides.query ?? vi.fn().mockResolvedValue(null),
    mutation: overrides.mutation ?? vi.fn().mockResolvedValue({}),
    // cast-through proxy: the client type is ConvexReactClient but we
    // only exercise the two methods the module touches.
  } as unknown as Parameters<typeof uploadKey>[0];
}

const KEY_HEX =
  "3c5e2bdf8a40219157f0d1b6afe43a0c7e58cb4d2f9a1e306b8cafdfe87c52d9";

/** A cloud row as the metadata reads return it: no key material. */
function row(droneId: string): CloudSigningKey {
  return {
    _id: `id-${droneId}`,
    userId: "user-A",
    droneId,
    keyId: "3c5e2bdf",
    linkIdOwner: 7,
    linkIdsInUse: [7],
    enrolledAt: "2026-04-17T00:00:00Z",
    updatedAt: Date.now(),
  };
}

describe("signing-cloud-sync", () => {
  describe("uploadKey", () => {
    it("rejects plaintext uploads while encrypted storage is unavailable", async () => {
      const mutation = vi.fn().mockResolvedValue({ _id: "row-1", keyId: "abc12345" });
      const client = fakeClient({ mutation });
      const args = {
        droneId: "drone-a",
        keyHex: "a".repeat(64),
        keyId: "abc12345",
        linkIdOwner: 4,
        enrolledAt: "2026-04-17T00:00:00Z",
      };
      await expect(uploadKey(client, args)).rejects.toThrow(
        "encrypted storage is available",
      );
      expect(mutation).not.toHaveBeenCalled();
    });
  });

  describe("listMyCloudKeys", () => {
    it("returns the query result as-is", async () => {
      const query = vi.fn().mockResolvedValue([row("drone-a"), row("drone-b")]);
      const client = fakeClient({ query });
      const result = await listMyCloudKeys(client);
      expect(result).toHaveLength(2);
      expect(result[0].droneId).toBe("drone-a");
    });
  });

  describe("getCloudKeyForDrone", () => {
    it("returns null when no row exists", async () => {
      const query = vi.fn().mockResolvedValue(null);
      const client = fakeClient({ query });
      expect(await getCloudKeyForDrone(client, "drone-a")).toBeNull();
    });
  });

  describe("removeCloudKey", () => {
    it("calls the removeKey mutation", async () => {
      const mutation = vi.fn().mockResolvedValue({ removed: true });
      const client = fakeClient({ mutation });
      const result = await removeCloudKey(client, "drone-a");
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(mutation.mock.calls[0][1]).toEqual({ droneId: "drone-a" });
      expect(result).toEqual({ removed: true });
    });
  });

  describe("allocateCloudLinkId", () => {
    it("returns the allocated linkId", async () => {
      const mutation = vi.fn().mockResolvedValue({ linkId: 7 });
      const client = fakeClient({ mutation });
      const linkId = await allocateCloudLinkId(client, "drone-a");
      expect(linkId).toBe(7);
    });
  });

  describe("releaseCloudLinkId", () => {
    it("calls the releaseLinkId mutation with both args", async () => {
      const mutation = vi.fn().mockResolvedValue({ released: true });
      const client = fakeClient({ mutation });
      await releaseCloudLinkId(client, "drone-a", 7);
      expect(mutation.mock.calls[0][1]).toEqual({ droneId: "drone-a", linkId: 7 });
    });
  });

  describe("exportCloudKeyBytes", () => {
    it("converts the exported 64-char hex to a 32-byte buffer", async () => {
      const mutation = vi
        .fn()
        .mockResolvedValue({ keyHex: KEY_HEX, keyId: "3c5e2bdf" });
      const client = fakeClient({ mutation });

      const result = await exportCloudKeyBytes(client, "drone-a", "fp-abcd");

      expect(result?.keyId).toBe("3c5e2bdf");
      expect(result?.bytes.length).toBe(32);
      expect(result?.bytes[0]).toBe(0x3c);
      expect(result?.bytes[1]).toBe(0x5e);
      // The device fingerprint travels with the export so the server-side
      // audit row records which browser took the key out.
      expect(mutation).toHaveBeenCalledWith(expect.anything(), {
        droneId: "drone-a",
        deviceFingerprint: "fp-abcd",
      });
    });

    it("returns null when the drone has no synced key", async () => {
      const mutation = vi.fn().mockResolvedValue(null);
      const client = fakeClient({ mutation });
      expect(
        await exportCloudKeyBytes(client, "drone-a", "fp-abcd"),
      ).toBeNull();
    });
  });
});
