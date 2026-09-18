/**
 * Server-side proxy for PX4 GitHub Releases API.
 *
 * Fetches releases from PX4/PX4-Autopilot, filters to those
 * containing .px4 firmware assets, and returns a structured
 * list with board display names.
 */

import { NextResponse } from "next/server";

import { fetchWithTimeout } from "@/lib/net/fetch-with-timeout";
import type { PX4Release, PX4Board } from "@/lib/protocol/firmware/types";

// ── Board Display Name Mapping ──────────────────────────────

const BOARD_DISPLAY_NAMES: Record<string, string> = {
  "px4_fmu-v2_default": "Pixhawk 1 (FMU v2)",
  "px4_fmu-v3_default": "Pixhawk 2 (FMU v3 / Cube)",
  "px4_fmu-v4_default": "Pixracer (FMU v4)",
  "px4_fmu-v4pro_default": "Drotek Pixhawk 3 Pro (FMU v4 Pro)",
  "px4_fmu-v5_default": "Pixhawk 4 (FMU v5)",
  "px4_fmu-v5x_default": "Pixhawk 5X (FMU v5X)",
  "px4_fmu-v6c_default": "Pixhawk 6C (FMU v6C)",
  "px4_fmu-v6x_default": "Pixhawk 6X (FMU v6X)",
  "px4_fmu-v6xrt_default": "Pixhawk 6X-RT (FMU v6X-RT)",
  "ark_fmu-v6x_default": "ARK FMU v6X",
  "auav_x2v1_default": "AUAV X2.1",
  "aerofc-v1_default": "Intel Aero FC",
  "bitcraze_crazyflie_default": "Bitcraze Crazyflie 2.0",
  "bitcraze_crazyflie21_default": "Bitcraze Crazyflie 2.1",
  "cuav_nora_default": "CUAV Nora",
  "cuav_x7pro_default": "CUAV X7 Pro",
  "cubepilot_cubeorange_default": "CubePilot CubeOrange",
  "cubepilot_cubeyellow_default": "CubePilot CubeYellow",
  "holybro_durandal-v1_default": "Holybro Durandal",
  "holybro_kakuteh7_default": "Holybro Kakute H7",
  "holybro_kakuteh7v2_default": "Holybro Kakute H7 v2",
  "holybro_kakuteh7mini_default": "Holybro Kakute H7 Mini",
  "mro_ctrl-zero-f7_default": "mRo Control Zero F7",
  "mro_ctrl-zero-h7_default": "mRo Control Zero H7",
  "mro_x2.1-777_default": "mRo X2.1-777",
  "mro_pixracerpro_default": "mRo Pixracer Pro",
  "modalai_fc-v1_default": "ModalAI FC v1",
  "modalai_fc-v2_default": "ModalAI FC v2",
  "nxp_fmuk66-v3_default": "NXP FMUK66 v3",
  "nxp_fmurt1062-v1_default": "NXP FMURT1062",
  "omnibus_f4sd_default": "Omnibus F4 SD",
  "spracing_h7extreme_default": "SPRacing H7 Extreme",
};

/**
 * Derive a display name from a .px4 asset filename.
 * Strips the file extension and looks up in the mapping table,
 * falling back to a cleaned-up version of the filename.
 */
function getBoardDisplayName(assetName: string): string {
  // Strip .px4 extension
  const baseName = assetName.replace(/\.px4$/, "");

  // Check exact mapping
  if (BOARD_DISPLAY_NAMES[baseName]) {
    return BOARD_DISPLAY_NAMES[baseName];
  }

  // Fallback: convert underscores/hyphens to spaces and title case
  return baseName
    .replace(/_default$/, "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── GitHub Release Types ────────────────────────────────────

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

// ── Server-side Cache ───────────────────────────────────────

let serverCache: { data: PX4Release[]; timestamp: number } | null = null;
const SERVER_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Route Handler ───────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
  // Return cached data if fresh
  if (serverCache && Date.now() - serverCache.timestamp < SERVER_CACHE_TTL) {
    return NextResponse.json(serverCache.data);
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "Altnautica-Command-GCS/1.0",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetchWithTimeout(
      "https://api.github.com/repos/PX4/PX4-Autopilot/releases?per_page=20",
      { headers },
    );

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      const detail = errorBody.includes("rate limit") ? " (GitHub API rate limit exceeded — export GITHUB_TOKEN in the server shell for 5000 req/hr)" : "";
      return NextResponse.json(
        { error: `GitHub API returned ${res.status}${detail}` },
        { status: 502 },
      );
    }

    const releases: GitHubRelease[] = await res.json();

    // Filter and transform releases that have .px4 assets
    const px4Releases: PX4Release[] = [];

    for (const release of releases) {
      const px4Assets = release.assets.filter((a) => a.name.endsWith(".px4"));
      if (px4Assets.length === 0) continue;

      const boards: PX4Board[] = px4Assets.map((asset) => ({
        name: asset.name.replace(/\.px4$/, ""),
        displayName: getBoardDisplayName(asset.name),
        assetUrl: asset.browser_download_url,
        size: asset.size,
      }));

      // Sort boards by display name
      boards.sort((a, b) => a.displayName.localeCompare(b.displayName));

      px4Releases.push({
        tag: release.tag_name,
        name: release.name || release.tag_name,
        prerelease: release.prerelease,
        boards,
      });
    }

    serverCache = { data: px4Releases, timestamp: Date.now() };
    return NextResponse.json(px4Releases);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
