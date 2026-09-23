// Exempt from 300 LOC soft rule: a curated icon-name vocabulary (data table).
/**
 * The one shared named-icon registry. Resolves a string icon name (from a
 * skill, a target action, a plugin manifest, a capability chip, an extension
 * card) to a single lucide glyph, so every surface — the Skill Bar, the gamepad
 * radial, the command palette, the plugin pop-up, the plugin card, and the
 * public website — renders the same glyph for the same name.
 *
 * Names are matched case- and separator-insensitively: `"crosshair"`,
 * `"Crosshair"`, `"cross-hair"`, and `"cross_hair"` all resolve to the same
 * glyph. Many human-friendly aliases map onto one glyph. An unknown name falls
 * back to a generic glyph rather than crashing. The 13 legacy PascalCase names
 * that built-in skills already ship (Power, ArrowUpFromLine, Crosshair, …)
 * resolve unchanged via their normalized keys, so no skill data has to migrate.
 *
 * Plugin manifests SHOULD declare lowercase-kebab names from this vocabulary
 * (e.g. `icon: "zoom-in"`). Keep this file in lockstep with the website mirror
 * `website/src/lib/extensions/skill-icon.ts`.
 *
 * @module icons/icon-registry
 * @license GPL-3.0-only
 */

import {
  Power,
  PlaneTakeoff,
  PlaneLanding,
  Home,
  Pause,
  Play,
  XOctagon,
  Skull,
  ArrowUpFromLine,
  ArrowDownToLine,
  LocateFixed,
  MoveVertical,
  Move,
  Move3d,
  Orbit,
  Circle,
  CircleStop,
  Crosshair,
  Target,
  Route,
  Spline,
  Navigation,
  Navigation2,
  Compass,
  Anchor,
  Wind,
  Camera,
  Video,
  Film,
  Image,
  ScanSearch,
  ScanLine,
  Focus,
  Aperture,
  Crop,
  Cctv,
  Ruler,
  Eye,
  Radar,
  Cpu,
  Thermometer,
  ThermometerSun,
  Flame,
  Snowflake,
  Satellite,
  SatelliteDish,
  Signal,
  Radio,
  Antenna,
  Battery,
  BatteryCharging,
  Gauge,
  ShieldCheck,
  ShieldAlert,
  Map as MapIcon,
  MapPin,
  Flag,
  Mountain,
  SlidersHorizontal,
  Wrench,
  Bell,
  Timer,
  Zap,
  Fan,
  Layers,
  Boxes,
  Package,
  Bug,
  Grid3x3,
  Gamepad2,
  Joystick,
  RefreshCw,
  Palette,
  ZoomIn,
  ZoomOut,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** Normalize an icon name to its lookup key: lowercase, alphanumerics only. */
export function normalizeIconName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The named-icon vocabulary. Keys are ALREADY normalized (lowercase, no
 * separators). Group by concept; many aliases per glyph is intentional.
 */
const ICON_VOCAB: Record<string, LucideIcon> = {
  // ---- Flight / vehicle ----
  power: Power,
  arm: Power,
  disarm: Power,
  takeoff: PlaneTakeoff,
  launch: PlaneTakeoff,
  land: PlaneLanding,
  landing: PlaneLanding,
  rth: Home,
  returnhome: Home,
  home: Home,
  loiter: Pause,
  hold: Pause,
  pause: Pause,
  resume: Play,
  play: Play,
  continue: Play,
  abort: XOctagon,
  stop: XOctagon,
  xoctagon: XOctagon,
  kill: Skull,
  emergency: Skull,
  skull: Skull,
  climb: ArrowUpFromLine,
  arrowupfromline: ArrowUpFromLine,
  descend: ArrowDownToLine,
  arrowdowntoline: ArrowDownToLine,
  nadir: ArrowDownToLine,
  positionhold: LocateFixed,
  locatefixed: LocateFixed,
  locate: LocateFixed,
  center: LocateFixed,
  recenter: LocateFixed,
  altitude: MoveVertical,
  movevertical: MoveVertical,
  orbit: Orbit,
  circle: Circle,
  circlestop: CircleStop,
  stopfollow: CircleStop,

  // ---- Targeting / follow / navigation ----
  follow: Crosshair,
  followme: Crosshair,
  crosshair: Crosshair,
  track: Crosshair,
  tracking: Crosshair,
  pointat: Crosshair,
  designate: Target,
  target: Target,
  waypoint: Route,
  mission: Route,
  route: Route,
  path: Spline,
  trajectory: Spline,
  spline: Spline,
  navigate: Navigation,
  navigation: Navigation,
  goto: Navigation,
  guided: Navigation2,
  navigation2: Navigation2,
  compass: Compass,
  heading: Compass,
  anchor: Anchor,
  stationkeep: Anchor,
  wind: Wind,
  weathervane: Wind,

  // ---- Camera / gimbal / optics ----
  camera: Camera,
  photo: Camera,
  capture: Camera,
  video: Video,
  record: Video,
  recording: Video,
  film: Film,
  image: Image,
  snapshot: Image,
  gimbal: Move3d,
  pantilt: Move3d,
  move3d: Move3d,
  move: Move,
  ratemode: Move,
  zoom: ZoomIn,
  zoomin: ZoomIn,
  zoomout: ZoomOut,
  scansearch: ScanSearch,
  focus: Focus,
  autofocus: Focus,
  aperture: Aperture,
  lens: Aperture,
  exposure: Aperture,
  crop: Crop,
  frame: Crop,
  pod: Cctv,
  turret: Cctv,
  cctv: Cctv,
  rangefinder: Ruler,
  laser: ScanLine,
  firelrf: ScanLine,
  ruler: Ruler,

  // ---- Vision / AI / compute ----
  vision: Eye,
  detect: Eye,
  detection: Eye,
  eye: Eye,
  scan: ScanLine,
  scanline: ScanLine,
  radar: Radar,
  lidar: Radar,
  ai: Cpu,
  model: Cpu,
  inference: Cpu,
  npu: Cpu,
  cpu: Cpu,
  compute: Cpu,

  // ---- Thermal ----
  thermal: Thermometer,
  thermometer: Thermometer,
  temperature: Thermometer,
  palette: Palette,
  cyclepalette: Palette,
  heat: ThermometerSun,
  thermalsun: ThermometerSun,
  spotmeter: Thermometer,
  spot: Thermometer,
  flatfield: RefreshCw,
  ffc: RefreshCw,
  flame: Flame,
  hot: Flame,
  cold: Snowflake,
  snow: Snowflake,
  snowflake: Snowflake,

  // ---- GPS / radio / link ----
  gps: Satellite,
  satellite: Satellite,
  gnss: SatelliteDish,
  satellitedish: SatelliteDish,
  signal: Signal,
  rssi: Signal,
  radio: Radio,
  telemetry: Radio,
  link: Radio,
  antenna: Antenna,

  // ---- Power / health ----
  battery: Battery,
  batterycharging: BatteryCharging,
  powerhealth: BatteryCharging,
  gauge: Gauge,
  meter: Gauge,

  // ---- Safety / geo ----
  safety: ShieldCheck,
  shield: ShieldCheck,
  shieldcheck: ShieldCheck,
  warning: ShieldAlert,
  caution: ShieldAlert,
  shieldalert: ShieldAlert,
  geofence: MapIcon,
  fence: MapIcon,
  map: MapIcon,
  overlay: MapIcon,
  location: MapPin,
  pin: MapPin,
  mappin: MapPin,
  geolocate: MapPin,
  geolocatetarget: MapPin,
  flag: Flag,
  mark: Flag,
  rally: Flag,
  terrain: Mountain,
  mountain: Mountain,

  // ---- System / tooling ----
  settings: SlidersHorizontal,
  config: SlidersHorizontal,
  tune: SlidersHorizontal,
  slidershorizontal: SlidersHorizontal,
  gain: SlidersHorizontal,
  maintenance: Wrench,
  wrench: Wrench,
  notification: Bell,
  bell: Bell,
  alert: Bell,
  timer: Timer,
  countdown: Timer,
  zap: Zap,
  boost: Zap,
  fan: Fan,
  cooling: Fan,
  layers: Layers,
  boxes: Boxes,
  bundle: Boxes,
  package: Package,
  plugin: Package,
  bug: Bug,
  debug: Bug,
  grid: Grid3x3,
  grid3x3: Grid3x3,
  gamepad: Gamepad2,
  rc: Gamepad2,
  gamepad2: Gamepad2,
  joystick: Joystick,
  refresh: RefreshCw,
  refreshcw: RefreshCw,
  status: Gauge,
  sparkles: Sparkles,
};

/** The generic fallback glyph for an unknown or empty icon name. */
export const FALLBACK_ICON: LucideIcon = Sparkles;

/**
 * Resolve a named icon to its lucide glyph. Case- and separator-insensitive;
 * falls back to a generic glyph for unknown/empty names.
 */
export function resolveNamedIcon(name?: string | null): LucideIcon {
  if (!name) return FALLBACK_ICON;
  const key = normalizeIconName(name);
  // Names come from third-party manifests; an own-key check keeps a name
  // like "constructor" from resolving to an inherited Object member.
  return Object.hasOwn(ICON_VOCAB, key) ? ICON_VOCAB[key] : FALLBACK_ICON;
}

/** True iff the name resolves to a real vocabulary entry (not the fallback). */
export function hasNamedIcon(name?: string | null): boolean {
  return !!name && Object.hasOwn(ICON_VOCAB, normalizeIconName(name));
}
