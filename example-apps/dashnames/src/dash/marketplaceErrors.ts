/**
 * Typed marketplace errors.
 *
 * EXTRACTABLE: no DPNS knowledge, no product copy. Shared code classifies; the
 * view layer owns the wording. If you find yourself writing a user-facing
 * sentence in this file, it belongs in a component instead.
 */
import { errorMessage } from "../lib/logger";

export type MarketplaceErrorKind =
  | "PriceMismatch"
  | "StaleRevision"
  | "NotOwner"
  | "SalesDisabled"
  | "InsufficientBalance"
  | "Unknown";

export interface MarketplaceError {
  kind: MarketplaceErrorKind;
  /** The raw protocol/consensus message, verbatim. Always surfaced to the user. */
  message: string;
}

/**
 * Result of a write operation.
 *
 * `transitionId` is reserved and stays `undefined`: the SDK's write methods
 * resolve `void` and expose no state-transition hash, so a transaction ID is not
 * obtainable client-side today. Declaring it now means adopting a future SDK
 * that returns one is not a caller-visible change.
 */
export type MarketplaceResult =
  { ok: true; transitionId?: string } | { ok: false; error: MarketplaceError };

export function marketplaceError(
  kind: MarketplaceErrorKind,
  message: string,
): MarketplaceError {
  return { kind, message };
}

/**
 * Classifies a thrown SDK/consensus error into the typed set, preserving the
 * original message.
 *
 * Matching is on substrings of the consensus error text, which is the only
 * signal the SDK surfaces. Anything unrecognized stays `Unknown` WITH its
 * message rather than being coerced into a nearby category — a wrong
 * classification is worse than an honest unknown.
 */
export function classifyMarketplaceError(err: unknown): MarketplaceError {
  const message = errorMessage(err);
  const lower = message.toLowerCase();

  if (
    lower.includes("price mismatch") ||
    lower.includes("invalid document purchase price") ||
    (lower.includes("price") && lower.includes("does not match"))
  ) {
    return marketplaceError("PriceMismatch", message);
  }

  if (
    lower.includes("revision") &&
    (lower.includes("mismatch") ||
      lower.includes("invalid") ||
      lower.includes("must be") ||
      lower.includes("greater"))
  ) {
    return marketplaceError("StaleRevision", message);
  }

  if (
    lower.includes("not owned") ||
    lower.includes("owner mismatch") ||
    lower.includes("identity is not the owner") ||
    lower.includes("unauthorized")
  ) {
    return marketplaceError("NotOwner", message);
  }

  if (
    lower.includes("balance is not sufficient") ||
    lower.includes("insufficient balance") ||
    lower.includes("insufficient funds") ||
    lower.includes("not enough credits")
  ) {
    return marketplaceError("InsufficientBalance", message);
  }

  // Pre-v13 networks reject these transitions via a data trigger.
  if (
    lower.includes("action is not allowed") ||
    lower.includes("data trigger") ||
    lower.includes("not allowed for this document type")
  ) {
    return marketplaceError("SalesDisabled", message);
  }

  return marketplaceError("Unknown", message);
}
