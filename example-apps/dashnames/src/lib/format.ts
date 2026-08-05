/**
 * Formatting helpers. Every credit amount is a `bigint` — no helper here ever
 * converts a price to `number`, because Platform credit prices legitimately
 * exceed Number.MAX_SAFE_INTEGER (see lib/safeDoc.ts).
 */

/** 1 DASH = 100,000,000,000 credits (10^11). */
export const CREDITS_PER_DASH = 100_000_000_000n;

const DASH_DECIMALS = 11;

/**
 * Formats credits as a DASH figure using integer math only.
 *
 * `maxDecimals` trims trailing zeros but always keeps at least `minDecimals`,
 * so a whole number still reads as "128.000" where the design shows three
 * decimal places.
 */
export function formatDash(
  credits: bigint,
  {
    minDecimals = 3,
    maxDecimals = 6,
  }: { minDecimals?: number; maxDecimals?: number } = {},
): string {
  const negative = credits < 0n;
  const abs = negative ? -credits : credits;
  const whole = abs / CREDITS_PER_DASH;
  const remainder = abs % CREDITS_PER_DASH;

  // Zero-pad the fractional part to the full 11 credit decimals, then trim.
  let frac = remainder
    .toString()
    .padStart(DASH_DECIMALS, "0")
    .slice(0, maxDecimals);
  while (frac.length > minDecimals && frac.endsWith("0")) {
    frac = frac.slice(0, -1);
  }

  const sign = negative ? "-" : "";
  const wholeText = whole.toLocaleString("en-US");
  return frac.length > 0
    ? `${sign}${wholeText}.${frac}`
    : `${sign}${wholeText}`;
}

/** Exact credit amount with thousands separators, e.g. "12,800,000,000,000". */
export function formatCredits(credits: bigint): string {
  return credits.toLocaleString("en-US");
}

/**
 * Compact credit amount for tight spots (tile footnotes), e.g. "31.0T".
 * Integer math only.
 */
export function formatCreditsCompact(credits: bigint): string {
  const abs = credits < 0n ? -credits : credits;
  if (abs < 10_000n) return formatCredits(credits);

  const units: Array<[bigint, string]> = [
    [1_000_000_000_000_000_000n, "E"],
    [1_000_000_000_000_000n, "Q"],
    [1_000_000_000_000n, "T"],
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "K"],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      const tenths = (abs * 10n) / scale;
      const whole = tenths / 10n;
      const frac = tenths % 10n;
      const sign = credits < 0n ? "-" : "";
      return `${sign}${whole.toLocaleString("en-US")}.${frac}${suffix}`;
    }
  }
  return formatCredits(credits);
}

/**
 * Parses a user-typed DASH amount into credits.
 *
 * Rejects empty, non-numeric, negative, and zero input — the design has no
 * zero-price path (delisting is a separate destructive action). Extra decimal
 * places beyond credit precision are rejected rather than silently truncated.
 */
export type ParseDashResult =
  | { ok: true; credits: bigint }
  | { ok: false; reason: "empty" | "invalid" | "zero" | "too-precise" };

export function parseDashToCredits(input: string): ParseDashResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (!/^\d*\.?\d*$/.test(text) || text === ".") {
    return { ok: false, reason: "invalid" };
  }

  const [wholeText = "", fracText = ""] = text.split(".");
  if (fracText.length > DASH_DECIMALS) {
    return { ok: false, reason: "too-precise" };
  }

  const whole = wholeText ? BigInt(wholeText) : 0n;
  const frac = fracText ? BigInt(fracText.padEnd(DASH_DECIMALS, "0")) : 0n;
  const credits = whole * CREDITS_PER_DASH + frac;
  if (credits <= 0n) return { ok: false, reason: "zero" };
  return { ok: true, credits };
}

/** Truncates an identifier as `XXXX…XXXX` — this app's convention for identity IDs. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 9) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** Relative time, e.g. "6h ago" / "4d ago" / "12s ago". */
export function relativeTime(
  timestampMs: number,
  nowMs: number = Date.now(),
): string {
  const deltaSec = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(deltaSec / 3600);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(deltaSec / 86_400);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return formatMonthYear(timestampMs);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Mar 2026" */
export function formatMonthYear(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Mar 14 2026" */
export function formatDate(timestampMs: number): string {
  const d = new Date(timestampMs);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}

/** Thousands-separated block height. */
export function formatBlock(
  height: bigint | number | null | undefined,
): string {
  if (height == null) return "—";
  const value =
    typeof height === "bigint" ? height : BigInt(Math.trunc(height));
  return value.toLocaleString("en-US");
}
