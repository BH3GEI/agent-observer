/**
 * Stage-one survey decision scorer — faithful TypeScript port of
 * `scoring/scorer.py` (the frozen Python reference implementation).
 *
 * Differences from the Python module are limited to the I/O surface:
 * functions operate on file *contents* (strings) instead of paths, and the
 * label used in error messages is the logical file name ("weather.csv", ...).
 * Every numeric operation keeps the same order of evaluation as the Python
 * code so that results agree to floating-point round-off.
 */

export const PROGRAMS: ReadonlySet<string> = new Set(["DARK", "BRIGHT", "BACKUP"]);
export const TARGET_CLASSES = ["LRG", "ELG", "QSO", "BGS"] as const;
export type TargetClass = (typeof TARGET_CLASSES)[number];

/** Raised when an input file violates the frozen submission schema. */
export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoringError";
  }
}

export interface ScoreConfig {
  schema_version: string;
  slot_seconds: number;
  latitude_deg: number;
  longitude_deg: number;
  minimum_altitude_deg: number;
  dark_threshold: number;
  bright_threshold: number;
  program_bonus: Record<string, number>;
  target_weights: Record<TargetClass, number>;
  characteristic_flux: Record<TargetClass, number>;
  reference_flux: number;
  low_flux_threshold: number;
  low_flux_bonus: number;
  idle_penalty_per_second: number;
}

/**
 * A UTC instant expressed as integer microseconds since the Unix epoch.
 * This mirrors Python's `datetime` (microsecond resolution) so that
 * `timestamp()` and `timedelta` arithmetic round identically.
 */
export type Micros = number;

export interface WeatherSlot {
  slot_id: string;
  night_id: string;
  timestamp_utc: Micros;
  duration_seconds: number;
  seeing_arcsec: number;
  transparency: number;
  sky_brightness: number;
  is_observable: boolean;
}

export function slotEndUtc(slot: WeatherSlot): Micros {
  return slot.timestamp_utc + timedeltaMicros(slot.duration_seconds);
}

export interface Tile {
  tile_id: string;
  ra_deg: number;
  dec_deg: number;
  program: string;
  region: number;
  priority: number;
  nominal_exptime_seconds: number;
  targets: Record<TargetClass, number>;
}

export interface Decision {
  decision_id: number;
  slot_id: string;
  action: string;
  tile_id: string;
  program: string;
  reason: string;
}

export interface Cursor {
  slot_index: number;
  offset_seconds: number;
}

export interface ActionDetail {
  decision_id: number;
  slot_id: string;
  action: string;
  tile_id: string;
  valid: boolean;
  message: string;
  start_timestamp_utc: string | null;
  elapsed_seconds: number;
  segments?: number;
  unproductive_seconds?: number;
  science_score: number;
  reason: string;
}

export interface Report {
  schema_version: string;
  status: string;
  score: number;
  science_score: number;
  waste_penalty: number;
  total_waste_seconds: number;
  waste_breakdown_seconds: {
    idle: number;
    invalid_actions: number;
    unproductive_exposure: number;
  };
  unavailable_unpenalized_seconds: number;
  completed_tiles: number;
  invalid_actions: number;
  region_completion: Record<string, number>;
  actions: ActionDetail[];
}

// ---------------------------------------------------------------------------
// Python-compatible numeric helpers
// ---------------------------------------------------------------------------

/**
 * Mirror of Python's `round(x, ndigits)` for floats: the *exact* binary value
 * is rounded to `ndigits` decimals with ties-to-even, then converted back to
 * the nearest double.  `toFixed(30)` yields the exact decimal expansion for
 * the magnitudes handled here, which lets us detect true ties.
 */
export function pyRound(x: number, ndigits = 6): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return x;
  const negative = x < 0;
  const text = Math.abs(x).toFixed(30);
  const dot = text.indexOf(".");
  const intPart = text.slice(0, dot);
  const frac = text.slice(dot + 1);
  const keep = frac.slice(0, ndigits);
  const rest = frac.slice(ndigits);
  let digits = (intPart + keep).split("").map((c) => c.charCodeAt(0) - 48);
  let roundUp = false;
  if (rest.length > 0) {
    const first = rest.charCodeAt(0) - 48;
    const tailNonZero = /[1-9]/.test(rest.slice(1));
    if (first > 5 || (first === 5 && tailNonZero)) {
      roundUp = true;
    } else if (first === 5 && !tailNonZero) {
      // exact tie -> round half to even
      const last = digits[digits.length - 1];
      roundUp = last % 2 === 1;
    }
  }
  if (roundUp) {
    let i = digits.length - 1;
    while (i >= 0) {
      if (digits[i] === 9) {
        digits[i] = 0;
        i -= 1;
      } else {
        digits[i] += 1;
        break;
      }
    }
    if (i < 0) digits = [1, ...digits];
  }
  const all = digits.join("");
  const intLen = all.length - ndigits;
  const out = ndigits > 0 ? `${all.slice(0, intLen) || "0"}.${all.slice(intLen)}` : all;
  const value = Number(out);
  return negative ? -value : value;
}

/** Python float `%` semantics (result takes the sign of the divisor). */
export function pyMod(a: number, b: number): number {
  let mod = a % b;
  if (mod !== 0 && (b < 0) !== (mod < 0)) mod += b;
  return mod;
}

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;
export function radians(deg: number): number {
  return deg * DEG_TO_RAD;
}
export function degrees(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** Python `round()` to an integer with ties-to-even. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Mirror of `timedelta(seconds=<float>)` reduced to integer microseconds:
 * CPython splits the float into integral and fractional seconds and rounds
 * the fractional part to microseconds with ties-to-even.
 */
export function timedeltaMicros(seconds: number): Micros {
  const whole = Math.trunc(seconds);
  const frac = seconds - whole;
  const us = roundHalfEven(frac * 1e6);
  return whole * 1_000_000 + us;
}

/** Mirror of `datetime.timestamp()` for an aware UTC datetime. */
export function timestampSeconds(moment: Micros): number {
  return moment / 1e6;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6})\d*)?)?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Parse an ISO 8601 UTC timestamp into microseconds.  Accepts `Z` or
 * `+00:00`; rejects naive timestamps and non-UTC offsets, matching the
 * validation order of the Python `_timestamp` helper.
 */
export function parseTimestampUtc(text: string, context: string): Micros {
  const m = ISO_RE.exec(text);
  if (!m) {
    throw new ScoringError(`${context}: invalid ISO 8601 timestamp ${pyRepr(text)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] ?? "0");
  const minute = Number(m[5] ?? "0");
  const second = Number(m[6] ?? "0");
  const fracText = m[7] ?? "";
  const tz = m[8];
  const micro = fracText ? Number(fracText.padEnd(6, "0")) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new ScoringError(`${context}: invalid ISO 8601 timestamp ${pyRepr(text)}`);
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ScoringError(`${context}: invalid ISO 8601 timestamp ${pyRepr(text)}`);
  }
  if (tz === undefined) {
    throw new ScoringError(`${context}: timestamp_utc must include a timezone`);
  }
  let offsetMinutes = 0;
  if (tz !== "Z" && tz !== "z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const hh = Number(tz.slice(1, 3));
    const mmText = tz.length > 3 ? tz.slice(-2) : "0";
    offsetMinutes = sign * (hh * 60 + Number(mmText));
  }
  if (offsetMinutes !== 0) {
    throw new ScoringError(`${context}: timestamp_utc must use UTC (Z or +00:00)`);
  }
  return ms * 1000 + micro;
}

/** Mirror of `datetime.isoformat().replace("+00:00", "Z")` for UTC values. */
export function formatTimestampUtc(moment: Micros): string {
  const ms = Math.floor(moment / 1000);
  const micro = moment - ms * 1000; // remaining microseconds within the millisecond
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  let out = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const totalMicro = d.getUTCMilliseconds() * 1000 + micro;
  if (totalMicro !== 0) out += `.${pad(totalMicro, 6)}`;
  return out + "Z";
}

/** Approximation of Python's `repr()` for strings (used in error messages). */
export function pyRepr(text: string): string {
  if (text.includes("'") && !text.includes('"')) {
    return `"${text}"`;
  }
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180-ish, mirroring csv.DictReader behaviour)
// ---------------------------------------------------------------------------

/** Parse CSV text into rows of fields.  Blank lines yield empty rows. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      fieldStarted = false;
      i += 1;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (fieldStarted || row.length > 0) {
        row.push(field);
      }
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
      if (c === "\r" && text[i + 1] === "\n") i += 2;
      else i += 1;
      continue;
    }
    field += c;
    fieldStarted = true;
    i += 1;
  }
  if (fieldStarted || row.length > 0 || inQuotes) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type CsvRow = Record<string, string | null>;

function readCsv(text: string, label: string, required: readonly string[]): CsvRow[] {
  const raw = parseCsv(text);
  let index = 0;
  // csv.DictReader skips leading blank rows before the header too.
  while (index < raw.length && raw[index].length === 0) index += 1;
  if (index >= raw.length) {
    throw new ScoringError(`${label}: missing CSV header`);
  }
  const fieldnames = raw[index];
  index += 1;
  const missing = required.filter((name) => !fieldnames.includes(name));
  if (missing.length) {
    throw new ScoringError(`${label}: missing columns: ${missing.join(", ")}`);
  }
  const rows: CsvRow[] = [];
  for (; index < raw.length; index += 1) {
    const values = raw[index];
    if (values.length === 0) continue; // DictReader skips empty rows
    const row: CsvRow = {};
    fieldnames.forEach((name, i) => {
      // later duplicate headers win, like dict(zip(...))
      row[name] = i < values.length ? values[i] : null;
    });
    rows.push(row);
  }
  if (!rows.length) {
    throw new ScoringError(`${label}: must contain at least one data row`);
  }
  return rows;
}

/** Python `str.strip()` — strips (Unicode) whitespace only. */
function pyStrip(text: string): string {
  return text.replace(/^\s+|\s+$/g, "");
}

function field(row: CsvRow, name: string, context: string): string {
  const value = name in row ? row[name] : "";
  if (value === null || value === undefined || !pyStrip(String(value))) {
    throw new ScoringError(`${context}: ${name} must not be empty`);
  }
  return pyStrip(String(value));
}

const PY_INT_RE = /^[+-]?\d+(?:_\d+)*$/;
const PY_FLOAT_RE =
  /^[+-]?(?:(?:\d+(?:_\d+)*)?\.?(?:\d+(?:_\d+)*)?(?:[eE][+-]?\d+(?:_\d+)*)?|inf|infinity|nan)$/i;

/** Mirror of Python `float(text)`; returns `undefined` where Python raises ValueError. */
export function pyParseFloat(text: string): number | undefined {
  const t = pyStrip(text);
  if (!PY_FLOAT_RE.test(t)) return undefined;
  const lower = t.toLowerCase().replace(/^[+-]/, "");
  const sign = t.startsWith("-") ? -1 : 1;
  if (lower === "inf" || lower === "infinity") return sign * Infinity;
  if (lower === "nan") return NaN;
  const cleaned = t.replace(/_/g, "");
  if (!/\d/.test(cleaned.replace(/[eE].*$/, ""))) return undefined; // mantissa needs a digit
  const value = Number(cleaned);
  return Number.isNaN(value) ? undefined : value;
}

/** Mirror of Python `int(text)`; returns `undefined` where Python raises ValueError. */
export function pyParseInt(text: string): number | undefined {
  const t = pyStrip(text);
  if (!PY_INT_RE.test(t)) return undefined;
  return Number(t.replace(/_/g, ""));
}

function floatField(row: CsvRow, name: string, context: string): number {
  const text = field(row, name, context);
  const value = pyParseFloat(text);
  if (value === undefined) {
    throw new ScoringError(`${context}: ${name} must be numeric, got ${pyRepr(text)}`);
  }
  if (!Number.isFinite(value)) {
    throw new ScoringError(`${context}: ${name} must be finite`);
  }
  return value;
}

function intField(row: CsvRow, name: string, context: string): number {
  const text = field(row, name, context);
  const value = pyParseInt(text);
  if (value === undefined) {
    throw new ScoringError(`${context}: ${name} must be an integer, got ${pyRepr(text)}`);
  }
  return value;
}

function boolField(row: CsvRow, name: string, context: string): boolean {
  const text = field(row, name, context).toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  throw new ScoringError(`${context}: ${name} must be true/false or 1/0`);
}

function timestampField(row: CsvRow, name: string, context: string): Micros {
  const text = field(row, name, context);
  return parseTimestampUtc(text, context);
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function requireMappingKeys(payload: unknown, keys: Iterable<string>, context: string): Record<string, unknown> {
  const present = new Set(
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload as Record<string, unknown>)
      : [],
  );
  const missing = [...keys].filter((k) => !present.has(k)).sort();
  if (missing.length) {
    throw new ScoringError(`${context}: missing keys: ${missing.join(", ")}`);
  }
  return payload as Record<string, unknown>;
}

/** Mirror of Python `float(value)` applied to a JSON value. */
function toFloat(value: unknown, context: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1.0 : 0.0;
  if (typeof value === "string") {
    const parsed = pyParseFloat(value);
    if (parsed !== undefined) return parsed;
  }
  throw new ScoringError(`${context}: could not convert ${JSON.stringify(value)} to float`);
}

/** Mirror of Python `int(value)` applied to a JSON value. */
function toInt(value: unknown, context: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ScoringError(`${context}: cannot convert ${value} to integer`);
    }
    return Math.trunc(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const parsed = pyParseInt(value);
    if (parsed !== undefined) return parsed;
  }
  throw new ScoringError(`${context}: invalid literal for int(): ${JSON.stringify(value)}`);
}

/** Mirror of Python `str(value)` for JSON scalars. */
function toStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value === null) return "None";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export function loadConfig(text: string, label = "score_config.json"): ScoreConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (exc) {
    throw new ScoringError(`cannot read score config ${label}: ${(exc as Error).message}`);
  }
  const top = requireMappingKeys(
    raw,
    [
      "schema_version",
      "slot_seconds",
      "site",
      "quality_thresholds",
      "program_bonus",
      "target_weights",
      "characteristic_flux",
      "reference_flux",
      "low_flux_threshold",
      "low_flux_bonus",
      "idle_penalty_per_second",
    ],
    "score config",
  );
  const site = requireMappingKeys(top["site"], ["latitude_deg", "longitude_deg", "minimum_altitude_deg"], "site");
  const thresholds = requireMappingKeys(top["quality_thresholds"], ["dark", "bright"], "quality_thresholds");
  const maps: Record<string, Record<string, unknown>> = {};
  for (const name of ["program_bonus", "target_weights", "characteristic_flux"]) {
    const required = name === "program_bonus" ? [...PROGRAMS] : [...TARGET_CLASSES];
    maps[name] = requireMappingKeys(top[name], required, name);
  }

  const programBonus: Record<string, number> = {};
  for (const name of PROGRAMS) programBonus[name] = toFloat(maps["program_bonus"][name], "program_bonus");
  const targetWeights = {} as Record<TargetClass, number>;
  const characteristicFlux = {} as Record<TargetClass, number>;
  for (const name of TARGET_CLASSES) {
    targetWeights[name] = toFloat(maps["target_weights"][name], "target_weights");
    characteristicFlux[name] = toFloat(maps["characteristic_flux"][name], "characteristic_flux");
  }

  const config: ScoreConfig = {
    schema_version: toStr(top["schema_version"]),
    slot_seconds: toInt(top["slot_seconds"], "slot_seconds"),
    latitude_deg: toFloat(site["latitude_deg"], "latitude_deg"),
    longitude_deg: toFloat(site["longitude_deg"], "longitude_deg"),
    minimum_altitude_deg: toFloat(site["minimum_altitude_deg"], "minimum_altitude_deg"),
    dark_threshold: toFloat(thresholds["dark"], "dark"),
    bright_threshold: toFloat(thresholds["bright"], "bright"),
    program_bonus: programBonus,
    target_weights: targetWeights,
    characteristic_flux: characteristicFlux,
    reference_flux: toFloat(top["reference_flux"], "reference_flux"),
    low_flux_threshold: toFloat(top["low_flux_threshold"], "low_flux_threshold"),
    low_flux_bonus: toFloat(top["low_flux_bonus"], "low_flux_bonus"),
    idle_penalty_per_second: toFloat(top["idle_penalty_per_second"], "idle_penalty_per_second"),
  };
  if (config.slot_seconds <= 0) {
    throw new ScoringError("score config: slot_seconds must be positive");
  }
  if (!(-90.0 <= config.latitude_deg && config.latitude_deg <= 90.0)) {
    throw new ScoringError("score config: latitude_deg must be in [-90, 90]");
  }
  if (!(-180.0 <= config.longitude_deg && config.longitude_deg <= 180.0)) {
    throw new ScoringError("score config: longitude_deg must be in [-180, 180]");
  }
  if (!(0.0 <= config.minimum_altitude_deg && config.minimum_altitude_deg < 90.0)) {
    throw new ScoringError("score config: minimum_altitude_deg must be in [0, 90)");
  }
  if (config.dark_threshold <= config.bright_threshold || config.bright_threshold < 0) {
    throw new ScoringError("score config: thresholds must satisfy dark > bright >= 0");
  }
  if (config.reference_flux <= 0) {
    throw new ScoringError("score config: reference_flux must be positive");
  }
  if (!(0.0 <= config.low_flux_threshold && config.low_flux_threshold <= 1.0)) {
    throw new ScoringError("score config: low_flux_threshold must be in [0, 1]");
  }
  if (config.low_flux_bonus < 0 || config.idle_penalty_per_second < 0) {
    throw new ScoringError("score config: bonuses and penalties must be non-negative");
  }
  return config;
}

export function loadWeather(text: string, config: ScoreConfig, label = "weather.csv"): WeatherSlot[] {
  const required = [
    "slot_id",
    "night_id",
    "timestamp_utc",
    "duration_seconds",
    "seeing_arcsec",
    "transparency",
    "sky_brightness",
    "is_observable",
  ];
  const rows = readCsv(text, label, required);
  const result: WeatherSlot[] = [];
  const seenSlots = new Set<string>();
  const closedNights = new Set<string>();
  let currentNight: string | null = null;

  rows.forEach((row, i) => {
    const line = i + 2;
    const context = `${label}: row ${line}`;
    const slotId = field(row, "slot_id", context);
    const nightId = field(row, "night_id", context);
    if (seenSlots.has(slotId)) {
      throw new ScoringError(`${context}: duplicate slot_id ${pyRepr(slotId)}`);
    }
    seenSlots.add(slotId);
    const duration = intField(row, "duration_seconds", context);
    const seeing = floatField(row, "seeing_arcsec", context);
    const transparency = floatField(row, "transparency", context);
    const sky = floatField(row, "sky_brightness", context);
    if (duration !== config.slot_seconds) {
      throw new ScoringError(
        `${context}: duration_seconds must equal configured slot_seconds=${config.slot_seconds}`,
      );
    }
    if (seeing <= 0 || sky <= 0) {
      throw new ScoringError(`${context}: seeing_arcsec and sky_brightness must be positive`);
    }
    if (!(0.0 <= transparency && transparency <= 1.0)) {
      throw new ScoringError(`${context}: transparency must be in [0, 1]`);
    }

    const item: WeatherSlot = {
      slot_id: slotId,
      night_id: nightId,
      timestamp_utc: timestampField(row, "timestamp_utc", context),
      duration_seconds: duration,
      seeing_arcsec: seeing,
      transparency,
      sky_brightness: sky,
      is_observable: boolField(row, "is_observable", context),
    };
    if (result.length) {
      const previous = result[result.length - 1];
      if (item.timestamp_utc <= previous.timestamp_utc) {
        throw new ScoringError(`${context}: weather timestamps must be strictly increasing`);
      }
      if (item.night_id === previous.night_id) {
        if (item.timestamp_utc !== slotEndUtc(previous)) {
          throw new ScoringError(`${context}: slots within a night must be contiguous`);
        }
      } else if (item.timestamp_utc < slotEndUtc(previous)) {
        throw new ScoringError(`${context}: weather slots must not overlap`);
      }
    }

    if (nightId !== currentNight) {
      if (currentNight !== null) closedNights.add(currentNight);
      if (closedNights.has(nightId)) {
        throw new ScoringError(`${context}: each night_id must occupy one contiguous block`);
      }
      currentNight = nightId;
    }
    result.push(item);
  });
  return result;
}

export function loadTiles(text: string, label = "tiles.csv"): Map<string, Tile> {
  const required = [
    "tile_id",
    "ra_deg",
    "dec_deg",
    "program",
    "region",
    "priority",
    "nominal_exptime_seconds",
    "n_lrg",
    "n_elg",
    "n_qso",
    "n_bgs",
  ];
  const rows = readCsv(text, label, required);
  const result = new Map<string, Tile>();
  rows.forEach((row, i) => {
    const line = i + 2;
    const context = `${label}: row ${line}`;
    const tileId = field(row, "tile_id", context);
    if (result.has(tileId)) {
      throw new ScoringError(`${context}: duplicate tile_id ${pyRepr(tileId)}`);
    }
    const ra = floatField(row, "ra_deg", context);
    const dec = floatField(row, "dec_deg", context);
    const program = field(row, "program", context).toUpperCase();
    const region = intField(row, "region", context);
    const priority = floatField(row, "priority", context);
    const exptime = intField(row, "nominal_exptime_seconds", context);
    if (!(0.0 <= ra && ra < 360.0)) {
      throw new ScoringError(`${context}: ra_deg must be in [0, 360)`);
    }
    if (!(-90.0 <= dec && dec <= 90.0)) {
      throw new ScoringError(`${context}: dec_deg must be in [-90, 90]`);
    }
    if (!PROGRAMS.has(program)) {
      throw new ScoringError(`${context}: program must be DARK, BRIGHT, or BACKUP`);
    }
    if (!(0 <= region && region <= 7)) {
      throw new ScoringError(`${context}: region must be an integer in [0, 7]`);
    }
    if (!(0.0 <= priority && priority <= 10.0)) {
      throw new ScoringError(`${context}: priority must be in [0, 10]`);
    }
    if (exptime <= 0) {
      throw new ScoringError(`${context}: nominal_exptime_seconds must be positive`);
    }
    const targets = {} as Record<TargetClass, number>;
    for (const targetClass of TARGET_CLASSES) {
      const count = intField(row, `n_${targetClass.toLowerCase()}`, context);
      if (count < 0) {
        throw new ScoringError(`${context}: target counts must be non-negative`);
      }
      targets[targetClass] = count;
    }
    result.set(tileId, {
      tile_id: tileId,
      ra_deg: ra,
      dec_deg: dec,
      program,
      region,
      priority,
      nominal_exptime_seconds: exptime,
      targets,
    });
  });
  return result;
}

export function loadDecisions(
  text: string,
  slotIndices: Map<string, number>,
  label = "decisions.csv",
): Decision[] {
  const required = ["decision_id", "slot_id", "action", "tile_id", "program", "reason"];
  const rows = readCsv(text, label, required);
  const result: Decision[] = [];
  const seenIds = new Set<number>();
  let previousId = -1;
  let previousSlotIndex = -1;
  rows.forEach((row, i) => {
    const line = i + 2;
    const context = `${label}: row ${line}`;
    const decisionId = intField(row, "decision_id", context);
    const slotId = field(row, "slot_id", context);
    const action = field(row, "action", context).toLowerCase();
    if (decisionId < 0 || seenIds.has(decisionId) || decisionId <= previousId) {
      throw new ScoringError(`${context}: decision_id must be unique and strictly increasing`);
    }
    const slotIndex = slotIndices.get(slotId);
    if (slotIndex === undefined) {
      throw new ScoringError(`${context}: unknown slot_id ${pyRepr(slotId)}`);
    }
    if (slotIndex < previousSlotIndex) {
      throw new ScoringError(`${context}: decision slot_id values must be chronological`);
    }
    if (action !== "observe" && action !== "wait") {
      throw new ScoringError(`${context}: action must be observe or wait`);
    }
    const tileId = pyStrip(String(row["tile_id"] ?? ""));
    const program = pyStrip(String(row["program"] ?? "")).toUpperCase();
    if (action === "observe") {
      if (!tileId || !program) {
        throw new ScoringError(`${context}: observe requires tile_id and program`);
      }
      if (!PROGRAMS.has(program)) {
        throw new ScoringError(`${context}: invalid program ${pyRepr(program)}`);
      }
    } else if (tileId || program) {
      throw new ScoringError(`${context}: wait requires empty tile_id and program`);
    }
    seenIds.add(decisionId);
    previousId = decisionId;
    previousSlotIndex = slotIndex;
    result.push({
      decision_id: decisionId,
      slot_id: slotId,
      action,
      tile_id: tileId,
      program,
      reason: pyStrip(String(row["reason"] ?? "")).slice(0, 500),
    });
  });
  return result;
}

// ---------------------------------------------------------------------------
// Astronomy helpers
// ---------------------------------------------------------------------------

function julianDate(moment: Micros): number {
  return 2440587.5 + timestampSeconds(moment) / 86400.0;
}

export function localSiderealTimeDeg(moment: Micros, longitudeDeg: number): number {
  const daysSinceJ2000 = julianDate(moment) - 2451545.0;
  const gmst = 280.46061837 + 360.98564736629 * daysSinceJ2000;
  return pyMod(gmst + longitudeDeg, 360.0);
}

export function altitudeAirmass(tile: Tile, moment: Micros, config: ScoreConfig): [number, number] {
  const latitude = radians(config.latitude_deg);
  const declination = radians(tile.dec_deg);
  const hourAngleDeg = pyMod(localSiderealTimeDeg(moment, config.longitude_deg) - tile.ra_deg + 180.0, 360.0) - 180.0;
  const hourAngle = radians(hourAngleDeg);
  let sinAltitude = Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  sinAltitude = Math.min(1.0, Math.max(-1.0, sinAltitude));
  const altitude = degrees(Math.asin(sinAltitude));
  const airmass = sinAltitude > 0 ? 1.0 / sinAltitude : Infinity;
  return [altitude, airmass];
}

export function targetValue(tile: Tile, config: ScoreConfig): number {
  let value = 0.0;
  for (const targetClass of TARGET_CLASSES) {
    let fluxFactor = Math.min(
      Math.max(config.characteristic_flux[targetClass] / config.reference_flux, 0.0),
      1.0,
    );
    if (fluxFactor <= config.low_flux_threshold) {
      fluxFactor *= config.low_flux_bonus;
    }
    value += tile.targets[targetClass] * config.target_weights[targetClass] * fluxFactor;
  }
  return value;
}

export function conditionProgram(quality: number, config: ScoreConfig): string {
  if (quality >= config.dark_threshold) return "DARK";
  if (quality >= config.bright_threshold) return "BRIGHT";
  return "BACKUP";
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ScoreEngine {
  config: ScoreConfig;
  weather: WeatherSlot[];
  tiles: Map<string, Tile>;
  slot_indices: Map<string, number>;
  cursor: Cursor = { slot_index: 0, offset_seconds: 0.0 };
  completed_tiles = new Set<string>();
  science_score = 0.0;
  idle_seconds = 0.0;
  invalid_seconds = 0.0;
  unproductive_exposure_seconds = 0.0;
  unavailable_seconds = 0.0;
  invalid_actions = 0;
  action_details: ActionDetail[] = [];

  constructor(config: ScoreConfig, weather: WeatherSlot[], tiles: Map<string, Tile>) {
    this.config = config;
    this.weather = weather;
    this.tiles = tiles;
    this.slot_indices = new Map(weather.map((slot, index) => [slot.slot_id, index]));
  }

  private normalizeCursor(): void {
    while (this.cursor.slot_index < this.weather.length) {
      const duration = this.weather[this.cursor.slot_index].duration_seconds;
      if (this.cursor.offset_seconds < duration - 1e-9) break;
      this.cursor.slot_index += 1;
      this.cursor.offset_seconds = 0.0;
    }
  }

  private cursorTimestamp(): Micros | null {
    this.normalizeCursor();
    if (this.cursor.slot_index >= this.weather.length) return null;
    return this.weather[this.cursor.slot_index].timestamp_utc + timedeltaMicros(this.cursor.offset_seconds);
  }

  private consumeGapUntil(targetIndex: number): void {
    this.normalizeCursor();
    if (targetIndex < this.cursor.slot_index) {
      throw new ScoringError(
        "decision schedule overlaps an earlier exposure; use the slot in which the previous action finishes",
      );
    }
    while (this.cursor.slot_index < targetIndex) {
      const slot = this.weather[this.cursor.slot_index];
      const remaining = slot.duration_seconds - this.cursor.offset_seconds;
      if (slot.is_observable) this.idle_seconds += remaining;
      else this.unavailable_seconds += remaining;
      this.cursor.slot_index += 1;
      this.cursor.offset_seconds = 0.0;
    }
  }

  private nightSecondsRemaining(): number {
    this.normalizeCursor();
    if (this.cursor.slot_index >= this.weather.length) return 0.0;
    const nightId = this.weather[this.cursor.slot_index].night_id;
    let total = this.weather[this.cursor.slot_index].duration_seconds - this.cursor.offset_seconds;
    for (let i = this.cursor.slot_index + 1; i < this.weather.length; i += 1) {
      const slot = this.weather[i];
      if (slot.night_id !== nightId) break;
      total += slot.duration_seconds;
    }
    return total;
  }

  /** Consume up to `seconds`, stopping at the current night boundary. */
  private consumeDuration(seconds: number, category: "invalid" | "idle"): number {
    let consumed = 0.0;
    this.normalizeCursor();
    if (this.cursor.slot_index >= this.weather.length) return consumed;
    const nightId = this.weather[this.cursor.slot_index].night_id;
    while (seconds > 1e-9 && this.cursor.slot_index < this.weather.length) {
      const slot = this.weather[this.cursor.slot_index];
      if (slot.night_id !== nightId) break;
      const amount = Math.min(seconds, slot.duration_seconds - this.cursor.offset_seconds);
      if (category === "invalid") {
        this.invalid_seconds += amount;
      } else if (category === "idle") {
        if (slot.is_observable) this.idle_seconds += amount;
        else this.unavailable_seconds += amount;
      } else {
        throw new Error(`unknown duration category: ${category}`);
      }
      consumed += amount;
      seconds -= amount;
      this.cursor.offset_seconds += amount;
      this.normalizeCursor();
    }
    return consumed;
  }

  private recordInvalid(decision: Decision, message: string, requestedSeconds: number | null): void {
    const start = this.cursorTimestamp();
    if (requestedSeconds === null) {
      if (this.cursor.slot_index < this.weather.length) {
        requestedSeconds = this.weather[this.cursor.slot_index].duration_seconds - this.cursor.offset_seconds;
      } else {
        requestedSeconds = 0.0;
      }
    }
    const elapsed = this.consumeDuration(Math.min(requestedSeconds, this.nightSecondsRemaining()), "invalid");
    this.invalid_actions += 1;
    this.action_details.push({
      decision_id: decision.decision_id,
      slot_id: decision.slot_id,
      action: decision.action,
      tile_id: decision.tile_id,
      valid: false,
      message,
      start_timestamp_utc: start !== null ? formatTimestampUtc(start) : null,
      elapsed_seconds: pyRound(elapsed, 6),
      science_score: 0.0,
      reason: decision.reason,
    });
  }

  private scoreObservation(decision: Decision, tile: Tile): void {
    const start = this.cursorTimestamp();
    let remaining = tile.nominal_exptime_seconds;
    let actionScore = 0.0;
    let unproductive = 0.0;
    let segmentCount = 0;
    const tileValue = targetValue(tile, this.config);
    const priorityFactor = 0.5 + 0.5 * tile.priority / 10.0;

    while (remaining > 1e-9) {
      this.normalizeCursor();
      const slot = this.weather[this.cursor.slot_index];
      const amount = Math.min(remaining, slot.duration_seconds - this.cursor.offset_seconds);
      const midpoint = slot.timestamp_utc + timedeltaMicros(this.cursor.offset_seconds + amount / 2.0);
      const [altitude, airmass] = altitudeAirmass(tile, midpoint, this.config);
      let segmentScore = 0.0;
      if (slot.is_observable && altitude >= this.config.minimum_altitude_deg && Number.isFinite(airmass)) {
        const quality = slot.transparency / (slot.seeing_arcsec * slot.sky_brightness * airmass);
        const matchingProgram = conditionProgram(quality, this.config);
        const bonus = decision.program === matchingProgram ? this.config.program_bonus[decision.program] : 0.0;
        segmentScore = quality *
          (amount / tile.nominal_exptime_seconds) *
          tileValue *
          priorityFactor *
          (1.0 + bonus);
      } else {
        this.unproductive_exposure_seconds += amount;
        unproductive += amount;
      }
      actionScore += segmentScore;
      remaining -= amount;
      this.cursor.offset_seconds += amount;
      segmentCount += 1;
    }

    this.normalizeCursor();
    this.completed_tiles.add(tile.tile_id);
    this.science_score += actionScore;
    this.action_details.push({
      decision_id: decision.decision_id,
      slot_id: decision.slot_id,
      action: "observe",
      tile_id: tile.tile_id,
      valid: true,
      message: "observed",
      start_timestamp_utc: start !== null ? formatTimestampUtc(start) : null,
      elapsed_seconds: tile.nominal_exptime_seconds,
      segments: segmentCount,
      unproductive_seconds: pyRound(unproductive, 6),
      science_score: pyRound(actionScore, 6),
      reason: decision.reason,
    });
  }

  apply(decision: Decision): void {
    const targetIndex = this.slot_indices.get(decision.slot_id);
    if (targetIndex === undefined) {
      throw new ScoringError(`unknown slot_id ${pyRepr(decision.slot_id)}`);
    }
    this.consumeGapUntil(targetIndex);
    this.normalizeCursor();
    if (this.cursor.slot_index >= this.weather.length) {
      throw new ScoringError("decision starts after the weather horizon");
    }
    if (decision.action === "wait") {
      const start = this.cursorTimestamp();
      const elapsed = this.consumeDuration(
        this.weather[this.cursor.slot_index].duration_seconds - this.cursor.offset_seconds,
        "idle",
      );
      this.action_details.push({
        decision_id: decision.decision_id,
        slot_id: decision.slot_id,
        action: "wait",
        tile_id: "",
        valid: true,
        message: "wait",
        start_timestamp_utc: start !== null ? formatTimestampUtc(start) : null,
        elapsed_seconds: pyRound(elapsed, 6),
        science_score: 0.0,
        reason: decision.reason,
      });
      return;
    }

    const tile = this.tiles.get(decision.tile_id);
    if (tile === undefined) {
      this.recordInvalid(decision, "unknown tile_id", null);
      return;
    }
    if (decision.program !== tile.program) {
      this.recordInvalid(decision, "decision program does not match tile program", tile.nominal_exptime_seconds);
      return;
    }
    if (this.completed_tiles.has(tile.tile_id)) {
      this.recordInvalid(decision, "tile has already been completed", tile.nominal_exptime_seconds);
      return;
    }
    if (tile.nominal_exptime_seconds > this.nightSecondsRemaining() + 1e-9) {
      this.recordInvalid(
        decision,
        "exposure cannot finish before the end of the night",
        this.nightSecondsRemaining(),
      );
      return;
    }
    this.scoreObservation(decision, tile);
  }

  finish(): void {
    this.normalizeCursor();
    while (this.cursor.slot_index < this.weather.length) {
      const slot = this.weather[this.cursor.slot_index];
      const remaining = slot.duration_seconds - this.cursor.offset_seconds;
      if (slot.is_observable) this.idle_seconds += remaining;
      else this.unavailable_seconds += remaining;
      this.cursor.slot_index += 1;
      this.cursor.offset_seconds = 0.0;
    }
  }

  report(): Report {
    const totalWaste = this.idle_seconds + this.invalid_seconds + this.unproductive_exposure_seconds;
    const wastePenalty = this.config.idle_penalty_per_second * totalWaste;
    const regionTotal: number[] = new Array(8).fill(0);
    const regionCompleted: number[] = new Array(8).fill(0);
    for (const tile of this.tiles.values()) {
      regionTotal[tile.region] += 1;
      if (this.completed_tiles.has(tile.tile_id)) regionCompleted[tile.region] += 1;
    }
    const regionCompletion: Record<string, number> = {};
    for (let region = 0; region < 8; region += 1) {
      regionCompletion[String(region)] = regionTotal[region]
        ? pyRound(regionCompleted[region] / regionTotal[region], 6)
        : 0.0;
    }
    return {
      schema_version: this.config.schema_version,
      status: "ok",
      score: pyRound(this.science_score - wastePenalty, 6),
      science_score: pyRound(this.science_score, 6),
      waste_penalty: pyRound(wastePenalty, 6),
      total_waste_seconds: pyRound(totalWaste, 6),
      waste_breakdown_seconds: {
        idle: pyRound(this.idle_seconds, 6),
        invalid_actions: pyRound(this.invalid_seconds, 6),
        unproductive_exposure: pyRound(this.unproductive_exposure_seconds, 6),
      },
      unavailable_unpenalized_seconds: pyRound(this.unavailable_seconds, 6),
      completed_tiles: this.completed_tiles.size,
      invalid_actions: this.invalid_actions,
      region_completion: regionCompletion,
      actions: this.action_details,
    };
  }
}

/**
 * Score a submission from in-memory file contents.  Equivalent to the Python
 * `score_files(weather_path, tiles_path, decisions_path, config_path)`.
 */
export function scoreFiles(
  weatherCsv: string,
  tilesCsv: string,
  decisionsCsv: string,
  configJson: string,
): Report {
  const config = loadConfig(configJson);
  const weather = loadWeather(weatherCsv, config);
  const tiles = loadTiles(tilesCsv);
  const slotIndices = new Map(weather.map((slot, index) => [slot.slot_id, index]));
  const decisions = loadDecisions(decisionsCsv, slotIndices);
  const engine = new ScoreEngine(config, weather, tiles);
  for (const decision of decisions) engine.apply(decision);
  engine.finish();
  return engine.report();
}

/** JSON with keys sorted recursively, matching `json.dumps(sort_keys=True, indent=2)`. */
export function stableJson(value: unknown, indent = 2): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sortKeys((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, indent);
}
