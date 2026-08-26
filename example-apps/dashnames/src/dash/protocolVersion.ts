/**
 * Reads the network's ACTIVE platform protocol version.
 *
 * DPNS trading was blocked before protocol v13 by a hardcoded
 * `reject_data_trigger` on `domain` documents. Both supported networks have
 * permanently activated v13, so this status is informational rather than a
 * write gate.
 *
 * WHERE THE NUMBER LIVES. `sdk.system.status()` reports two unrelated kinds of
 * version, and it is easy to grab the wrong one:
 *
 *   version.software.drive   "4.1.0"                  <- Drive the software (semver)
 *   version.protocol.drive   {latest: 13, current: 13} <- the PROTOCOL version  ← this one
 *   version.protocol.tenderdash {p2p: 10, block: 14}   <- Tenderdash's protocols
 *
 * `version.protocol` is keyed by *which protocol*, so the platform protocol
 * version is namespaced under `drive` because Drive is the component that
 * defines it. It is a protocol version (13), NOT a Drive release (4.1.0).
 *
 * Read `current`, NOT `latest`: `latest` is the newest version the network knows
 * about, while `current` is what it is actually running. The distinction
 * mattered while mainnet knew about v13 but still ran v12. Verified 2026-08-26:
 * both testnet and mainnet now report `{latest: 13, current: 13}`.
 *
 * Note `sdk.version()` is a third, different number: the SDK's negotiated
 * version rather than the network status shown here.
 *
 * SDK method: sdk.system.status()
 */
import type { DashSdk } from "./types";

export interface ProtocolStatus {
  /**
   * Active platform protocol version (`version.protocol.drive.current`), or
   * null when it could not be determined.
   */
  activeProtocolVersion: number | null;
  /**
   * Newest protocol version the network knows about
   * (`version.protocol.drive.latest`). Informational only — never the gate.
   */
  knownProtocolVersion: number | null;
  /** Current block height, for the sync chip and footer. */
  blockHeight: bigint | null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function readBigIntish(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  // `chain.latestBlockHeight` arrives as a decimal STRING (verified live).
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function pick(source: unknown, key: string): unknown {
  if (!source || typeof source !== "object") return undefined;
  const direct = (source as Record<string, unknown>)[key];
  if (direct !== undefined) return direct;

  // `sdk.system.status()` returns WASM handles whose fields are NOT reachable by
  // plain property access — `status.chain` has only a `__wbg_ptr` key until it
  // is serialized. `toJSON()` is safe here: the status object carries no u64
  // that would overflow (block heights come back as decimal strings), unlike a
  // document's `$price`. See lib/safeDoc.ts for the case where it is not safe.
  const toJSON = (source as { toJSON?: () => unknown }).toJSON;
  if (typeof toJSON === "function") {
    try {
      const json = toJSON.call(source);
      if (json && typeof json === "object") {
        return (json as Record<string, unknown>)[key];
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Parses `sdk.system.status()`.
 *
 * Any shape we cannot read leaves `activeProtocolVersion` null. Protocol status
 * is informational now that both supported networks permanently meet v13.
 */
export function parseProtocolStatus(status: unknown): ProtocolStatus {
  const protocol = pick(pick(status, "version"), "protocol");
  // `protocol.drive` is the platform protocol version — not to be confused with
  // `software.drive`, which is Drive's semver release.
  const platformProtocol = pick(protocol, "drive");

  const activeProtocolVersion = readNumber(pick(platformProtocol, "current"));
  const knownProtocolVersion = readNumber(pick(platformProtocol, "latest"));

  const chain = pick(status, "chain");
  const blockHeight =
    readBigIntish(pick(chain, "latestBlockHeight")) ??
    readBigIntish(pick(chain, "blockHeight")) ??
    readBigIntish(pick(status, "blockHeight"));

  return {
    activeProtocolVersion,
    knownProtocolVersion,
    blockHeight,
  };
}

/** The empty status used before a status read completes or after it errors. */
export const UNKNOWN_PROTOCOL_STATUS: ProtocolStatus = {
  activeProtocolVersion: null,
  knownProtocolVersion: null,
  blockHeight: null,
};

export async function fetchProtocolStatus({
  sdk,
  signal,
}: {
  sdk: DashSdk;
  signal?: AbortSignal;
}): Promise<ProtocolStatus> {
  signal?.throwIfAborted();
  const status = await sdk.system.status();
  signal?.throwIfAborted();
  return parseProtocolStatus(status);
}
