"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const FEET_TO_METERS = 0.3048;

interface AdsbLolAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  category?: string;
  seen?: number;
  t?: string;
  r?: string;
}

interface NormalizedAircraft {
  icao24: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altitudeMsl: number | null;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
  category: number;
  lastSeen: number;
  originCountry: string;
  registration: string | null;
  aircraftType: string | null;
}

const REGIONS: Record<string, { lat: number; lon: number }> = {
  // ── POLAR & SUBARCTIC (65N-78N) ────────────────────────────────
  "polar-iceland":          { lat: 65.0, lon: -19.0 },
  "polar-norway":           { lat: 69.0, lon: 18.0 },
  "polar-finland":          { lat: 65.0, lon: 26.0 },
  "polar-russia-west":      { lat: 67.0, lon: 50.0 },
  "polar-siberia":          { lat: 67.0, lon: 80.0 },
  "polar-alaska":           { lat: 64.0, lon: -150.0 },
  "polar-canada":           { lat: 64.0, lon: -100.0 },

  // ── NORTHERN (55N-65N) ─────────────────────────────────────────
  "north-scotland":         { lat: 57.0, lon: -4.0 },
  "north-scandinavia":      { lat: 59.5, lon: 18.0 },
  "north-baltics":          { lat: 59.0, lon: 30.0 },
  "north-russia":           { lat: 56.0, lon: 44.0 },
  "north-russia-urals":     { lat: 57.0, lon: 60.0 },
  "north-russia-siberia":   { lat: 56.0, lon: 82.0 },
  "north-canada-west":      { lat: 56.0, lon: -120.0 },
  "north-canada-east":      { lat: 56.0, lon: -75.0 },

  // ── UPPER MID-LATITUDE (48N-55N) ──────────────────────────────
  "europe-uk":              { lat: 51.5, lon: -1.0 },
  "europe-france":          { lat: 48.8, lon: 2.3 },
  "europe-germany":         { lat: 50.0, lon: 10.0 },
  "europe-poland":          { lat: 52.0, lon: 20.0 },
  "russia-central":         { lat: 50.0, lon: 45.0 },
  "russia-east":            { lat: 50.0, lon: 90.0 },
  "russia-far-east":        { lat: 50.0, lon: 132.0 },
  "us-pacific-nw":          { lat: 48.0, lon: -122.0 },
  "us-great-lakes":         { lat: 42.0, lon: -84.0 },
  "us-northeast":           { lat: 41.0, lon: -74.0 },
  "canada-atlantic":        { lat: 47.0, lon: -60.0 },

  // ── LOWER MID-LATITUDE (35N-48N) ──────────────────────────────
  "europe-iberia":          { lat: 40.0, lon: -4.0 },
  "europe-italy":           { lat: 42.0, lon: 12.5 },
  "europe-greece-turkey":   { lat: 39.0, lon: 27.0 },
  "turkey-east":            { lat: 39.0, lon: 38.0 },
  "central-asia":           { lat: 41.0, lon: 69.0 },
  "china-north":            { lat: 40.0, lon: 116.0 },
  "china-northwest":        { lat: 40.0, lon: 100.0 },
  "korea":                  { lat: 37.0, lon: 127.0 },
  "japan":                  { lat: 36.0, lon: 140.0 },
  "us-west":                { lat: 37.5, lon: -122.0 },
  "us-south":               { lat: 33.0, lon: -97.0 },
  "us-florida":             { lat: 28.5, lon: -81.0 },

  // ── SUBTROPICAL (25N-35N) ──────────────────────────────────────
  "africa-morocco":         { lat: 33.5, lon: -7.5 },
  "africa-egypt":           { lat: 30.0, lon: 31.0 },
  "middle-east-levant":     { lat: 32.0, lon: 36.0 },
  "middle-east-gulf":       { lat: 25.0, lon: 55.0 },
  "middle-east-saudi":      { lat: 25.0, lon: 45.0 },
  "india-north":            { lat: 28.5, lon: 77.0 },
  "china-east":             { lat: 31.0, lon: 121.0 },
  "china-south":            { lat: 23.0, lon: 113.0 },
  "pacific-hawaii":         { lat: 21.0, lon: -157.0 },
  "mexico":                 { lat: 19.5, lon: -99.0 },

  // ── TROPICAL (10N-25N) ─────────────────────────────────────────
  "india-west":             { lat: 19.0, lon: 73.0 },
  "india-south":            { lat: 13.0, lon: 78.0 },
  "india-east":             { lat: 22.5, lon: 88.5 },
  "se-asia-myanmar":        { lat: 17.0, lon: 97.0 },
  "se-asia-vietnam":        { lat: 16.0, lon: 108.0 },
  "philippines":            { lat: 14.5, lon: 121.0 },
  "caribbean":              { lat: 19.0, lon: -72.0 },
  "west-africa-sahel":      { lat: 12.0, lon: 0.0 },
  "west-africa-nigeria":    { lat: 9.0, lon: 7.5 },

  // ── EQUATORIAL (10N-10S) ───────────────────────────────────────
  "se-asia-singapore":      { lat: 1.4, lon: 104.0 },
  "indonesia-west":         { lat: -2.0, lon: 107.0 },
  "indonesia-east":         { lat: -5.0, lon: 120.0 },
  "east-africa":            { lat: -1.0, lon: 37.0 },
  "central-africa":         { lat: 2.0, lon: 18.0 },
  "south-america-colombia": { lat: 4.5, lon: -74.0 },

  // ── SOUTHERN TROPICAL (10S-25S) ────────────────────────────────
  "brazil-east":            { lat: -23.0, lon: -43.0 },
  "brazil-central":         { lat: -15.5, lon: -48.0 },
  "brazil-north":           { lat: -3.0, lon: -60.0 },
  "africa-south-east":      { lat: -15.0, lon: 35.0 },
  "africa-south":           { lat: -26.0, lon: 28.0 },
  "indian-ocean":           { lat: -20.0, lon: 57.0 },
  "australia-north":        { lat: -16.0, lon: 136.0 },
  "south-pacific-fiji":     { lat: -18.0, lon: 178.0 },

  // ── SOUTHERN MID-LATITUDE (25S-45S) ────────────────────────────
  "australia-east":         { lat: -33.5, lon: 151.0 },
  "australia-west":         { lat: -32.0, lon: 116.0 },
  "new-zealand":            { lat: -37.0, lon: 175.0 },
  "south-america-argentina":{ lat: -34.5, lon: -58.5 },
  "south-america-chile":    { lat: -33.5, lon: -71.0 },
  "south-america-peru":     { lat: -12.0, lon: -77.0 },

  // ── OCEANIC CORRIDORS ──────────────────────────────────────────
  "nat-west":               { lat: 52.0, lon: -30.0 },
  "nat-east":               { lat: 54.0, lon: -15.0 },
  "pacific-north":          { lat: 45.0, lon: -170.0 },
  "pacific-central":        { lat: 28.0, lon: 140.0 },
};

function normalizeAircraft(a: AdsbLolAircraft, fetchTime: number): NormalizedAircraft | null {
  const lat = Number(a.lat);
  const lon = Number(a.lon);
  if (!lat && !lon) return null;
  if (!a.hex) return null;

  return {
    icao24: String(a.hex).toLowerCase(),
    callsign: typeof a.flight === "string" ? a.flight.trim() || null : null,
    lat,
    lon,
    altitudeMsl:
      a.alt_baro != null && a.alt_baro !== "ground"
        ? Number(a.alt_baro) * FEET_TO_METERS
        : null,
    velocity: a.gs != null ? Number(a.gs) * 0.514444 : null,
    heading: a.track != null ? Number(a.track) : null,
    verticalRate:
      a.baro_rate != null
        ? (Number(a.baro_rate) * FEET_TO_METERS) / 60
        : null,
    squawk: a.squawk != null ? String(a.squawk) : null,
    category: Number(a.category) || 0,
    lastSeen: a.seen != null ? fetchTime - Number(a.seen) * 1000 : fetchTime,
    originCountry: "",
    registration: typeof a.r === "string" ? a.r.trim() || null : null,
    aircraftType: typeof a.t === "string" ? a.t.trim() || null : null,
  };
}

export const syncAdsb = internalAction({
  args: {},
  handler: async (ctx) => {
    const fetchTime = Date.now();

    const entries = Object.entries(REGIONS);
    const FETCH_BATCH_SIZE = 20;
    let totalFailed = 0;

    // Accumulate all region results, then batch-upsert
    const allRegionResults: Array<{
      region: string;
      aircraft: string;
      source: string;
      fetchedAt: number;
      count: number;
    }> = [];

    for (let i = 0; i < entries.length; i += FETCH_BATCH_SIZE) {
      const batch = entries.slice(i, i + FETCH_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ([region, { lat, lon }]) => {
          const url = `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/250`;
          const res = await fetch(url);
          if (!res.ok) {
            console.warn(`[adsb-cache] ${region}: HTTP ${res.status}`);
            return;
          }

          const data = await res.json();
          const rawAc: AdsbLolAircraft[] = data.ac ?? [];

          const aircraft: NormalizedAircraft[] = [];
          for (const a of rawAc) {
            const norm = normalizeAircraft(a, fetchTime);
            if (norm) aircraft.push(norm);
          }

          let jsonStr = JSON.stringify(aircraft);
          let count = aircraft.length;

          // Check Convex 1MB doc limit (leave margin)
          if (jsonStr.length > 900_000) {
            console.warn(`[adsb-cache] ${region}: ${aircraft.length} aircraft exceeds size limit, truncating`);
            const truncated = aircraft.slice(0, Math.floor(aircraft.length * 0.7));
            jsonStr = JSON.stringify(truncated);
            count = truncated.length;
          }

          allRegionResults.push({
            region,
            aircraft: jsonStr,
            source: "adsb.lol",
            fetchedAt: fetchTime,
            count,
          });

          console.log(`[adsb-cache] ${region}: ${count} aircraft cached`);
        })
      );
      totalFailed += results.filter((r) => r.status === "rejected").length;
    }

    if (totalFailed > 0) {
      console.error(`[adsb-cache] ${totalFailed}/${entries.length} regions failed`);
    }

    // Batch upsert in chunks of 20 (keeps args under 8MB Convex limit)
    const UPSERT_BATCH_SIZE = 20;
    for (let i = 0; i < allRegionResults.length; i += UPSERT_BATCH_SIZE) {
      const chunk = allRegionResults.slice(i, i + UPSERT_BATCH_SIZE);
      await ctx.runMutation(internal.cmdAdsbCacheMutations.batchUpsertRegions, {
        regions: chunk,
      });
    }

    // Clean up stale region docs from previous grid configurations
    const validRegions = new Set(Object.keys(REGIONS));
    const existingDocs = await ctx.runQuery(internal.cmdAdsbCacheMutations.listAdsbRegions);
    const staleRegions = existingDocs.filter((r: string) => !validRegions.has(r));
    if (staleRegions.length > 0) {
      await ctx.runMutation(internal.cmdAdsbCacheMutations.batchDeleteRegions, {
        regions: staleRegions,
      });
      console.log(`[adsb-cache] cleaned up ${staleRegions.length} stale regions`);
    }
  },
});

export const syncOpenSky = internalAction({
  args: {},
  handler: async (ctx) => {
    const fetchTime = Date.now();

    try {
      const headers: Record<string, string> = {};
      const username = process.env.OPENSKY_USERNAME;
      const password = process.env.OPENSKY_PASSWORD;
      if (username && password) {
        headers["Authorization"] =
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
      }

      const res = await fetch("https://opensky-network.org/api/states/all", {
        headers,
      });
      if (!res.ok) {
        console.warn(`[opensky-cache] HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      const states: unknown[][] = data.states ?? [];

      const aircraft: NormalizedAircraft[] = [];
      for (const s of states) {
        const lat = s[6] as number | null;
        const lon = s[5] as number | null;
        const icao24 = s[0] as string | null;
        if (!lat || !lon || !icao24) continue;

        aircraft.push({
          icao24: String(icao24).toLowerCase(),
          callsign:
            typeof s[1] === "string" ? s[1].trim() || null : null,
          lat,
          lon,
          altitudeMsl: typeof s[7] === "number" ? s[7] : null,
          velocity: typeof s[9] === "number" ? s[9] : null,
          heading: typeof s[10] === "number" ? s[10] : null,
          verticalRate: typeof s[11] === "number" ? s[11] : null,
          squawk: typeof s[14] === "string" ? s[14] : null,
          category: typeof s[17] === "number" ? Number(s[17]) : 0,
          lastSeen:
            typeof s[4] === "number" ? s[4] * 1000 : fetchTime,
          originCountry: typeof s[2] === "string" ? s[2] : "",
          registration: null,
          aircraftType: null,
        });
      }

      // Split into chunks of ~3000 to stay under Convex 900KB doc limit
      const CHUNK_SIZE = 3000;
      const totalChunks = Math.ceil(aircraft.length / CHUNK_SIZE);

      // Accumulate all chunks, then batch-upsert
      const allRegionResults: Array<{
        region: string;
        aircraft: string;
        source: string;
        fetchedAt: number;
        count: number;
      }> = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunk = aircraft.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const region = `opensky-${i}`;
        let jsonStr = JSON.stringify(chunk);
        let count = chunk.length;

        if (jsonStr.length > 900_000) {
          const truncated = chunk.slice(0, Math.floor(chunk.length * 0.7));
          jsonStr = JSON.stringify(truncated);
          count = truncated.length;
        }

        allRegionResults.push({
          region,
          aircraft: jsonStr,
          source: "opensky",
          fetchedAt: fetchTime,
          count,
        });
      }

      // Single batch upsert for all opensky chunks
      if (allRegionResults.length > 0) {
        await ctx.runMutation(internal.cmdAdsbCacheMutations.batchUpsertRegions, {
          regions: allRegionResults,
        });
      }

      // Delete stale opensky-* docs beyond current chunk count
      const existingRegions = await ctx.runQuery(
        internal.cmdAdsbCacheMutations.listOpenSkyRegions,
      );
      const staleRegions = existingRegions.filter((existing: string) => {
        const idx = parseInt(existing.replace("opensky-", ""), 10);
        return idx >= totalChunks;
      });
      if (staleRegions.length > 0) {
        await ctx.runMutation(internal.cmdAdsbCacheMutations.batchDeleteRegions, {
          regions: staleRegions,
        });
      }

      console.log(
        `[opensky-cache] ${aircraft.length} aircraft cached in ${totalChunks} chunks`,
      );
    } catch (err) {
      console.error("[opensky-cache] fetch failed", err);
    }
  },
});


