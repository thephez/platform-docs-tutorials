/**
 * Contract IDs and query limits.
 *
 * SYNCHRONOUS by design: these run inside `useState` initializers before the
 * SDK module has loaded. Never add an SDK import (even type-only would be
 * fine, but a value import would drag the ~8 MB bundle onto the boot path).
 *
 * Both IDs verified live on 2026-08-05.
 */

/** DPNS — the `domain` documents that are the tradeable asset. Exists on both networks. */
export const DPNS_CONTRACT_ID = "GWRSAVFMjXx8HpQFaNJMqBV7MBgMK4br5UESsB4S31Ec";

/**
 * Document History — the system contract that records `priceUpdate`,
 * `purchase`, and `transfer` events. DPNS opted into it at protocol v13, which
 * is what makes listing discovery possible at all: `$price` is not indexed on
 * `domain`, so there is no way to ask Platform "what is for sale".
 *
 * The v13 upgrade creates this contract. Both supported networks now run v13,
 * and the ID is deterministic across them. `isMissingContractError` in
 * historyQueries.ts still handles unavailable contracts defensively.
 */
export const HISTORY_CONTRACT_ID =
  "6voHRaoiPcfmMhbqCA9dixH98xcgPQ9UEcuaXjpVu3LD";

/** The document type traded by this app. */
export const DOMAIN_DOCUMENT_TYPE = "domain";

/** Only `.dash` names are traded; stored per-record so this can widen later. */
export const PARENT_DOMAIN_NAME = "dash";

/**
 * Maximum size of an `$id IN [...]` clause. Verified exactly 100 — 101 IDs is
 * rejected with "invalid IN clause error".
 */
export const MAX_IN_CLAUSE = 100;

/** Platform caps a single document query at 100 results. */
export const MAX_QUERY_LIMIT = 100;

export type Network = "testnet" | "mainnet";

export const DEFAULT_NETWORK: Network = "testnet";

export function isNetwork(value: unknown): value is Network {
  return value === "testnet" || value === "mainnet";
}
