/**
 * @module atlas/viewers/splat-format
 * @description Derive a splat artifact's real format from its URL. The artifact
 * is reached through the same-origin proxy `/api/lan-pair/artifact?host=…&path=…`,
 * so the URL itself ends in a query string, not a file extension — which defeats
 * the splat loader's `endsWith('.ply')` sniffing. We read the extension from the
 * proxy's `path` query param (the real relative path) when present, else the
 * pathname (a direct URL), so the viewer can pass an explicit format.
 * @license GPL-3.0-only
 */

/** A splat artifact's file kind. */
export type SplatExt = "ply" | "splat" | "ksplat" | "spz";

/**
 * The artifact's file kind, derived from the proxy `path` query param when the
 * URL is a same-origin proxy URL, else from its pathname. Defaults to `ply`
 * (the only format the compute node emits today) when nothing matches.
 */
export function splatArtifactExt(url: string): SplatExt {
  let source = url;
  try {
    const u = new URL(url, "http://placeholder.invalid");
    source = u.searchParams.get("path") ?? u.pathname;
  } catch {
    // Not URL-parseable — fall back to the raw string.
  }
  const ext = source.toLowerCase().split(".").pop() ?? "";
  if (ext === "splat" || ext === "ksplat" || ext === "spz") return ext;
  return "ply";
}
