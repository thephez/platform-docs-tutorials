/**
 * Keeps the wallet-issued session key across reloads: the key's bytes are
 * wrapped with AES-GCM under a non-extractable device key that lives in the
 * browser's key store, and both go into IndexedDB. That protects the key at
 * rest and in profile backups; script running on this origin can still use
 * it, so the key's own bounds, allowance and expiry remain the real limit.
 *
 * One record per browser: dashnote is testnet only and holds one wallet
 * session at a time. No SDK imports here; the session reads it at boot.
 */

/** What the session needs to restore a wallet sign-in, without the key. */
export interface StoredWalletSession {
  identityId: string;
  keyId: number;
  contractId: string;
  totalBudget: bigint | null;
  /** Block time, ms. */
  expiresAt: number | null;
  /** This device's clock when the wallet's answer was accepted, ms. */
  grantedAt: number;
}

/** Whether this browser can keep a key here (IndexedDB and Web Crypto usable). */
export async function walletSessionStorageAvailable(): Promise<boolean> {
  throw new Error("not implemented");
}

/**
 * Wraps `privateKey` under the device key and stores it with `session`,
 * replacing any earlier record. The caller still owns and wipes its bytes.
 */
export async function saveWalletSession(
  _session: StoredWalletSession,
  _privateKey: Uint8Array,
): Promise<void> {
  throw new Error("not implemented");
}

/** The stored session without its key, or null. */
export async function peekWalletSession(): Promise<StoredWalletSession | null> {
  throw new Error("not implemented");
}

/**
 * The stored session with its key unwrapped, or null. The caller wipes the
 * returned bytes. A record that no longer opens is deleted and reported as null.
 */
export async function loadWalletSession(): Promise<{
  session: StoredWalletSession;
  privateKey: Uint8Array;
} | null> {
  throw new Error("not implemented");
}

export async function clearWalletSession(): Promise<void> {
  throw new Error("not implemented");
}
