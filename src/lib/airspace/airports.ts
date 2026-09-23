import { haversineDistance } from "@/lib/geo/distance";
/**
 * @module airspace/airports
 * @description Static, offline dataset of major international airports plus a
 * nearest-airport lookup. This is a keyless reference table (no OpenAIP / no
 * network) used by the static-ring airspace proximity gate. Coordinates are the
 * approximate airport reference point in decimal degrees (WGS84).
 * @license GPL-3.0-only
 */


/** A major airport reference point. */
export interface Airport {
  /** Common airport name. */
  name: string;
  /** ICAO location indicator (4 letters). */
  icao: string;
  /** IATA code (3 letters), where widely known. */
  iata: string;
  /** Latitude of the airport reference point (decimal degrees). */
  lat: number;
  /** Longitude of the airport reference point (decimal degrees). */
  lon: number;
}

/**
 * A curated set of well-known international airports worldwide. Not exhaustive —
 * this is a coarse static ring for planning-time proximity warnings, not an
 * authoritative airspace database. Extend as needed.
 */
export const MAJOR_AIRPORTS: readonly Airport[] = [
  // North America
  { name: "Hartsfield-Jackson Atlanta", icao: "KATL", iata: "ATL", lat: 33.6407, lon: -84.4277 },
  { name: "Los Angeles International", icao: "KLAX", iata: "LAX", lat: 33.9416, lon: -118.4085 },
  { name: "Chicago O'Hare", icao: "KORD", iata: "ORD", lat: 41.9742, lon: -87.9073 },
  { name: "Dallas/Fort Worth", icao: "KDFW", iata: "DFW", lat: 32.8998, lon: -97.0403 },
  { name: "New York John F. Kennedy", icao: "KJFK", iata: "JFK", lat: 40.6413, lon: -73.7781 },
  { name: "San Francisco International", icao: "KSFO", iata: "SFO", lat: 37.6213, lon: -122.379 },
  { name: "Seattle-Tacoma", icao: "KSEA", iata: "SEA", lat: 47.4502, lon: -122.3088 },
  { name: "Denver International", icao: "KDEN", iata: "DEN", lat: 39.8561, lon: -104.6737 },
  { name: "Miami International", icao: "KMIA", iata: "MIA", lat: 25.7959, lon: -80.287 },
  { name: "Boston Logan", icao: "KBOS", iata: "BOS", lat: 42.3656, lon: -71.0096 },
  { name: "Toronto Pearson", icao: "CYYZ", iata: "YYZ", lat: 43.6777, lon: -79.6248 },
  { name: "Vancouver International", icao: "CYVR", iata: "YVR", lat: 49.1967, lon: -123.1815 },
  { name: "Mexico City Benito Juarez", icao: "MMMX", iata: "MEX", lat: 19.4361, lon: -99.0719 },
  // South America
  { name: "Sao Paulo Guarulhos", icao: "SBGR", iata: "GRU", lat: -23.4356, lon: -46.4731 },
  { name: "Buenos Aires Ezeiza", icao: "SAEZ", iata: "EZE", lat: -34.8222, lon: -58.5358 },
  { name: "Bogota El Dorado", icao: "SKBO", iata: "BOG", lat: 4.7016, lon: -74.1469 },
  { name: "Santiago Arturo Merino Benitez", icao: "SCEL", iata: "SCL", lat: -33.393, lon: -70.7858 },
  { name: "Lima Jorge Chavez", icao: "SPJC", iata: "LIM", lat: -12.0219, lon: -77.1143 },
  // Europe
  { name: "London Heathrow", icao: "EGLL", iata: "LHR", lat: 51.47, lon: -0.4543 },
  { name: "Paris Charles de Gaulle", icao: "LFPG", iata: "CDG", lat: 49.0097, lon: 2.5479 },
  { name: "Amsterdam Schiphol", icao: "EHAM", iata: "AMS", lat: 52.3105, lon: 4.7683 },
  { name: "Frankfurt am Main", icao: "EDDF", iata: "FRA", lat: 50.0379, lon: 8.5622 },
  { name: "Munich", icao: "EDDM", iata: "MUC", lat: 48.3538, lon: 11.7861 },
  { name: "Madrid Barajas", icao: "LEMD", iata: "MAD", lat: 40.4936, lon: -3.5668 },
  { name: "Barcelona El Prat", icao: "LEBL", iata: "BCN", lat: 41.2974, lon: 2.0833 },
  { name: "Rome Fiumicino", icao: "LIRF", iata: "FCO", lat: 41.8003, lon: 12.2389 },
  { name: "Istanbul", icao: "LTFM", iata: "IST", lat: 41.2753, lon: 28.7519 },
  { name: "Zurich", icao: "LSZH", iata: "ZRH", lat: 47.4647, lon: 8.5492 },
  { name: "Vienna", icao: "LOWW", iata: "VIE", lat: 48.1103, lon: 16.5697 },
  { name: "Copenhagen Kastrup", icao: "EKCH", iata: "CPH", lat: 55.618, lon: 12.656 },
  { name: "Dublin", icao: "EIDW", iata: "DUB", lat: 53.4213, lon: -6.2701 },
  { name: "Lisbon Humberto Delgado", icao: "LPPT", iata: "LIS", lat: 38.7742, lon: -9.1342 },
  { name: "Moscow Sheremetyevo", icao: "UUEE", iata: "SVO", lat: 55.9726, lon: 37.4146 },
  // Middle East
  { name: "Dubai International", icao: "OMDB", iata: "DXB", lat: 25.2532, lon: 55.3657 },
  { name: "Doha Hamad", icao: "OTHH", iata: "DOH", lat: 25.2731, lon: 51.6081 },
  { name: "Abu Dhabi International", icao: "OMAA", iata: "AUH", lat: 24.433, lon: 54.6511 },
  { name: "Tel Aviv Ben Gurion", icao: "LLBG", iata: "TLV", lat: 32.0114, lon: 34.8867 },
  // South Asia
  { name: "Delhi Indira Gandhi", icao: "VIDP", iata: "DEL", lat: 28.5562, lon: 77.1 },
  { name: "Mumbai Chhatrapati Shivaji", icao: "VABB", iata: "BOM", lat: 19.0896, lon: 72.8656 },
  { name: "Bengaluru Kempegowda", icao: "VOBL", iata: "BLR", lat: 13.1986, lon: 77.7066 },
  { name: "Chennai International", icao: "VOMM", iata: "MAA", lat: 12.9941, lon: 80.1709 },
  { name: "Hyderabad Rajiv Gandhi", icao: "VOHS", iata: "HYD", lat: 17.2403, lon: 78.4294 },
  { name: "Kolkata Netaji Subhas Chandra Bose", icao: "VECC", iata: "CCU", lat: 22.6547, lon: 88.4467 },
  // East / Southeast Asia
  { name: "Singapore Changi", icao: "WSSS", iata: "SIN", lat: 1.3644, lon: 103.9915 },
  { name: "Hong Kong International", icao: "VHHH", iata: "HKG", lat: 22.308, lon: 113.9185 },
  { name: "Beijing Capital", icao: "ZBAA", iata: "PEK", lat: 40.0799, lon: 116.6031 },
  { name: "Shanghai Pudong", icao: "ZSPD", iata: "PVG", lat: 31.1443, lon: 121.8083 },
  { name: "Guangzhou Baiyun", icao: "ZGGG", iata: "CAN", lat: 23.3924, lon: 113.2988 },
  { name: "Tokyo Haneda", icao: "RJTT", iata: "HND", lat: 35.5494, lon: 139.7798 },
  { name: "Tokyo Narita", icao: "RJAA", iata: "NRT", lat: 35.772, lon: 140.3929 },
  { name: "Seoul Incheon", icao: "RKSI", iata: "ICN", lat: 37.4602, lon: 126.4407 },
  { name: "Bangkok Suvarnabhumi", icao: "VTBS", iata: "BKK", lat: 13.69, lon: 100.7501 },
  { name: "Kuala Lumpur International", icao: "WMKK", iata: "KUL", lat: 2.7456, lon: 101.7099 },
  { name: "Jakarta Soekarno-Hatta", icao: "WIII", iata: "CGK", lat: -6.1256, lon: 106.6559 },
  // Oceania
  { name: "Sydney Kingsford Smith", icao: "YSSY", iata: "SYD", lat: -33.9399, lon: 151.1753 },
  { name: "Melbourne Tullamarine", icao: "YMML", iata: "MEL", lat: -37.669, lon: 144.841 },
  { name: "Brisbane International", icao: "YBBN", iata: "BNE", lat: -27.3842, lon: 153.1175 },
  { name: "Auckland International", icao: "NZAA", iata: "AKL", lat: -37.0082, lon: 174.785 },
  // Africa
  { name: "Johannesburg O.R. Tambo", icao: "FAOR", iata: "JNB", lat: -26.1392, lon: 28.246 },
  { name: "Cape Town International", icao: "FACT", iata: "CPT", lat: -33.9715, lon: 18.6021 },
  { name: "Cairo International", icao: "HECA", iata: "CAI", lat: 30.1219, lon: 31.4056 },
  { name: "Nairobi Jomo Kenyatta", icao: "HKJK", iata: "NBO", lat: -1.3192, lon: 36.9278 },
  { name: "Lagos Murtala Muhammed", icao: "DNMM", iata: "LOS", lat: 6.5774, lon: 3.3212 },
] as const;

/** Result of a nearest-airport lookup. */
export interface NearestAirportResult {
  airport: Airport;
  /** Great-circle distance from the query point to the airport (kilometers). */
  distanceKm: number;
}

/**
 * Find the closest airport in {@link MAJOR_AIRPORTS} to a query point.
 * Returns `null` only if the dataset is empty (it is not, in practice).
 */
export function nearestAirport(lat: number, lon: number): NearestAirportResult | null {
  let best: NearestAirportResult | null = null;
  for (const airport of MAJOR_AIRPORTS) {
    const distanceKm = haversineDistance(lat, lon, airport.lat, airport.lon) / 1000;
    if (best === null || distanceKm < best.distanceKm) {
      best = { airport, distanceKm };
    }
  }
  return best;
}
