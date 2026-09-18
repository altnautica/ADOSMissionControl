import { describe, expect, it } from "vitest";
import { splatArtifactExt } from "@/components/atlas/viewers/splat-format";

describe("splatArtifactExt", () => {
  it("reads the extension from the proxy `path` param, not the URL tail", () => {
    // The proxied URL ends in a query string, not `.ply` — the exact case
    // that made mkkellogg's `endsWith` sniffing fail. The real ext is in
    // `path`, and `path` is not the last param.
    const url =
      "/api/lan-pair/artifact?path=artifacts/ds/output.ply&host=192.168.1.5";
    expect(splatArtifactExt(url)).toBe("ply");
  });

  it("detects .splat / .ksplat / .spz from the proxy path", () => {
    const base = "/api/lan-pair/artifact?host=h&path=artifacts/ds/output";
    expect(splatArtifactExt(`${base}.splat`)).toBe("splat");
    expect(splatArtifactExt(`${base}.ksplat`)).toBe("ksplat");
    expect(splatArtifactExt(`${base}.spz`)).toBe("spz");
  });

  it("falls back to the pathname for a direct URL", () => {
    expect(
      splatArtifactExt("http://192.168.1.5:8092/artifacts/ds/output.ply"),
    ).toBe("ply");
    expect(
      splatArtifactExt("http://192.168.1.5:8092/artifacts/ds/output.splat"),
    ).toBe("splat");
  });

  it("is case-insensitive", () => {
    expect(splatArtifactExt("http://h/x/OUTPUT.PLY")).toBe("ply");
    expect(splatArtifactExt("/api/lan-pair/artifact?path=x/O.SPLAT")).toBe(
      "splat",
    );
  });

  it("defaults to ply for an unknown or missing extension", () => {
    expect(splatArtifactExt("/api/lan-pair/artifact?host=h&path=artifacts/ds")).toBe(
      "ply",
    );
    expect(splatArtifactExt("http://h/artifacts/ds/output.bin")).toBe("ply");
    expect(splatArtifactExt("not a url")).toBe("ply");
  });
});
