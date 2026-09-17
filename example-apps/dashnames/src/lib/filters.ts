/**
 * Browse filters and sorting.
 *
 * Pure functions over the in-memory listing set — the local index is the only
 * thing that can answer these questions, since Platform has no `$price` index.
 *
 * Every price comparison is bigint. Never `Number(price)`.
 */
import { CREDITS_PER_DASH } from "./format";
import type { Listing } from "../dash/listingTypes";

export type PriceBand = "any" | "under10" | "10to100" | "over100";
export type LengthFilter = 3 | 4 | 5 | 6;
export type CharRule = "lettersOnly" | "noHyphens" | "noDigits";
export type HistoryRule = "hasSold" | "priceDropped";
export type SortKey = "priceAsc" | "priceDesc" | "recent" | "lengthAsc";

export interface Filters {
  priceBand: PriceBand;
  lengths: LengthFilter[];
  charRules: CharRule[];
  historyRules: HistoryRule[];
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  priceBand: "any",
  lengths: [],
  charRules: [],
  historyRules: [],
  sort: "priceAsc",
};

const TEN_DASH = 10n * CREDITS_PER_DASH;
const HUNDRED_DASH = 100n * CREDITS_PER_DASH;

function matchesPriceBand(price: bigint, band: PriceBand): boolean {
  switch (band) {
    case "under10":
      return price < TEN_DASH;
    case "10to100":
      return price >= TEN_DASH && price <= HUNDRED_DASH;
    case "over100":
      return price > HUNDRED_DASH;
    default:
      return true;
  }
}

function matchesLength(label: string, lengths: LengthFilter[]): boolean {
  if (lengths.length === 0) return true;
  // "6+" is an open-ended bucket.
  return lengths.some((len) =>
    len === 6 ? label.length >= 6 : label.length === len,
  );
}

function matchesCharRules(label: string, rules: CharRule[]): boolean {
  return rules.every((rule) => {
    switch (rule) {
      case "lettersOnly":
        return /^[a-z]+$/.test(label);
      case "noHyphens":
        return !label.includes("-");
      case "noDigits":
        return !/\d/.test(label);
      default:
        return true;
    }
  });
}

/**
 * Extra per-listing facts the history rules need. Supplied by the caller
 * because they come from the history streams, not the listing itself.
 */
export interface ListingHistoryFacts {
  hasSold: boolean;
  priceDropped: boolean;
}

export function applyFilters(
  listings: readonly Listing[],
  filters: Filters,
  facts?: Map<string, ListingHistoryFacts>,
): Listing[] {
  const filtered = listings.filter((listing) => {
    if (!matchesPriceBand(listing.price, filters.priceBand)) return false;
    if (!matchesLength(listing.normalizedLabel, filters.lengths)) return false;
    if (!matchesCharRules(listing.normalizedLabel, filters.charRules))
      return false;

    if (filters.historyRules.length > 0) {
      const fact = facts?.get(listing.documentId);
      // Without history facts the rule cannot be evaluated, so the listing is
      // excluded rather than silently passing an unchecked filter.
      if (!fact) return false;
      if (filters.historyRules.includes("hasSold") && !fact.hasSold)
        return false;
      if (filters.historyRules.includes("priceDropped") && !fact.priceDropped) {
        return false;
      }
    }
    return true;
  });

  return sortListings(filtered, filters.sort);
}

export function sortListings(listings: Listing[], sort: SortKey): Listing[] {
  const out = [...listings];
  switch (sort) {
    case "priceAsc":
      // bigint comparison, not subtraction — a bigint difference isn't a number.
      return out.sort((a, b) =>
        a.price < b.price ? -1 : a.price > b.price ? 1 : 0,
      );
    case "priceDesc":
      return out.sort((a, b) =>
        a.price > b.price ? -1 : a.price < b.price ? 1 : 0,
      );
    case "lengthAsc":
      return out.sort(
        (a, b) =>
          a.normalizedLabel.length - b.normalizedLabel.length ||
          a.normalizedLabel.localeCompare(b.normalizedLabel),
      );
    case "recent":
    default:
      return out.sort((a, b) => b.seenAt - a.seenAt);
  }
}

/** Human summary of the active filters, for the results toolbar. */
export function describeFilters(filters: Filters): string {
  const parts: string[] = [];
  if (filters.priceBand === "under10") parts.push("under 10 DASH");
  if (filters.priceBand === "10to100") parts.push("10–100 DASH");
  if (filters.priceBand === "over100") parts.push("100 DASH +");
  if (filters.lengths.length > 0) {
    parts.push(
      filters.lengths
        .slice()
        .sort((a, b) => a - b)
        .map((l) => (l === 6 ? "6+" : String(l)))
        .join("/") + " characters",
    );
  }
  if (filters.charRules.includes("lettersOnly")) parts.push("letters only");
  if (filters.charRules.includes("noHyphens")) parts.push("no hyphens");
  if (filters.charRules.includes("noDigits")) parts.push("no digits");
  if (filters.historyRules.includes("hasSold")) parts.push("has sold before");
  if (filters.historyRules.includes("priceDropped"))
    parts.push("price dropped");
  return parts.join(" · ");
}
