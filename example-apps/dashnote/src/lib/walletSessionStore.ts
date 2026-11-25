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

interface SessionRecord extends StoredWalletSession {
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

const DB_NAME = "dashnote.walletSession";
const DB_VERSION = 1;
const STORE = "records";
const DEVICE_KEY = "deviceKey";
const SESSION = "session";

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function hasSubtle(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle?.encrypt === "function"
  );
}

function unavailable(): Error {
  return new Error("Wallet session storage is unavailable");
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

// Runs one transaction and resolves with the request's result once it commits.
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

// The first key written wins: the check and the put share one transaction, so
// a tab that loses the race wraps under the winner's key, not its own.
async function deviceKey(): Promise<CryptoKey> {
  const existing = await withStore<unknown>("readonly", (store) =>
    store.get(DEVICE_KEY),
  );
  if (isCryptoKey(existing)) return existing;

  const fresh = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const stored = await withStore<unknown>("readwrite", (store) => {
    const get = store.get(DEVICE_KEY);
    get.onsuccess = () => {
      if (!isCryptoKey(get.result)) store.put(fresh, DEVICE_KEY);
    };
    return get;
  });
  return isCryptoKey(stored) ? stored : fresh;
}

// Ties the ciphertext to its identity, key and contract.
function additionalData(session: StoredWalletSession): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${session.identityId}:${session.keyId}:${session.contractId}`,
  );
}

function pickSession(session: StoredWalletSession): StoredWalletSession {
  return {
    identityId: session.identityId,
    keyId: session.keyId,
    contractId: session.contractId,
    totalBudget: session.totalBudget,
    expiresAt: session.expiresAt,
    grantedAt: session.grantedAt,
  };
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.identityId === "string" &&
    Number.isInteger(r.keyId) &&
    typeof r.contractId === "string" &&
    (r.totalBudget === null || typeof r.totalBudget === "bigint") &&
    (r.expiresAt === null || typeof r.expiresAt === "number") &&
    typeof r.grantedAt === "number" &&
    r.iv instanceof Uint8Array &&
    r.iv.length === 12 &&
    r.ciphertext instanceof ArrayBuffer
  );
}

// A synchronous marker beside the record, naming the grant it protects
// ("identityId:keyId"). A reader accepts the record only when the marker
// names it, so a clear that drops the marker first is final even if its
// IndexedDB delete fails, a save that sets the marker first can crash
// without leaving an older key restorable, and a clear for one grant can
// never touch a record another tab saved for a different one.
const ACTIVE_KEY = "dashnote.walletSession.active";

function grantTag(grant: { identityId: string; keyId: number }): string {
  return `${grant.identityId}:${grant.keyId}`;
}

function hasLocalStorage(): boolean {
  try {
    const probe = `${ACTIVE_KEY}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readMarker(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeMarker(tag: string | null): void {
  try {
    if (tag === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, tag);
  } catch {
    // without localStorage nothing is ever accepted; see storage availability
  }
}

// Deletes the record only while it is still the given grant.
async function deleteSessionIf(grant: {
  identityId: string;
  keyId: number;
}): Promise<void> {
  try {
    await withStore<unknown>("readwrite", (store) => {
      const get = store.get(SESSION);
      get.onsuccess = () => {
        const current = get.result as unknown;
        if (
          isSessionRecord(current) &&
          current.identityId === grant.identityId &&
          current.keyId === grant.keyId
        ) {
          store.delete(SESSION);
        }
      };
      return get;
    });
  } catch {
    // nothing more to do
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

// Deletes the session record, but only if it is still the one that failed to
// open; a session another tab saved meanwhile stays.
async function discardSession(failedIv: Uint8Array | null): Promise<void> {
  try {
    await withStore<unknown>("readwrite", (store) => {
      const get = store.get(SESSION);
      get.onsuccess = () => {
        const current = get.result as unknown;
        const stale =
          !isSessionRecord(current) ||
          (failedIv !== null && sameBytes(current.iv, failedIv));
        if (stale) store.delete(SESSION);
      };
      return get;
    });
  } catch {
    // nothing more to do
  }
}

async function readSession(): Promise<unknown> {
  if (!hasIndexedDb()) return undefined;
  let record: unknown;
  try {
    record = await withStore<unknown>("readonly", (store) =>
      store.get(SESSION),
    );
  } catch {
    return undefined;
  }
  if (isSessionRecord(record) && readMarker() !== grantTag(record)) {
    // Cleared, or superseded by a save whose record is still on its way.
    await deleteSessionIf(record);
    return undefined;
  }
  return record;
}

/** Whether this browser can keep a key here (IndexedDB and Web Crypto usable). */
export async function walletSessionStorageAvailable(): Promise<boolean> {
  if (!hasIndexedDb() || !hasSubtle() || !hasLocalStorage()) return false;
  try {
    const db = await openDb();
    db.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps `privateKey` under the device key and stores it with `session`,
 * replacing any earlier record. The caller still owns and wipes its bytes.
 */
export async function saveWalletSession(
  session: StoredWalletSession,
  privateKey: Uint8Array,
): Promise<void> {
  if (!hasIndexedDb() || !hasSubtle()) throw unavailable();
  let key: CryptoKey;
  try {
    key = await deviceKey();
  } catch {
    throw unavailable();
  }

  const plain = privateKey.slice();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(session) },
      key,
      plain,
    );
  } finally {
    plain.fill(0);
  }

  const record: SessionRecord = { ...pickSession(session), iv, ciphertext };
  // The marker goes first: a reader never sees the new record as stale, and
  // a crash before the write leaves nothing a reader would accept.
  if (!hasLocalStorage()) throw unavailable();
  writeMarker(grantTag(session));
  await withStore("readwrite", (store) => store.put(record, SESSION));
}

/** The stored session without its key, or null. */
export async function peekWalletSession(): Promise<StoredWalletSession | null> {
  const record = await readSession();
  return isSessionRecord(record) ? pickSession(record) : null;
}

/**
 * The stored session with its key unwrapped, or null. The caller wipes the
 * returned bytes. A record that no longer opens is deleted and reported as null.
 */
export async function loadWalletSession(): Promise<{
  session: StoredWalletSession;
  privateKey: Uint8Array;
} | null> {
  if (!hasSubtle()) return null;
  const record = await readSession();
  if (record === undefined) return null;
  if (!isSessionRecord(record)) {
    await discardSession(null);
    return null;
  }

  try {
    const key = await withStore<unknown>("readonly", (store) =>
      store.get(DEVICE_KEY),
    );
    if (!isCryptoKey(key)) throw new Error("Device key is missing");
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(record.iv),
        additionalData: additionalData(record),
      },
      key,
      record.ciphertext,
    );
    return { session: pickSession(record), privateKey: new Uint8Array(plain) };
  } catch {
    await discardSession(record.iv);
    return null;
  }
}

/**
 * Forgets the kept session. With `match`, only a record for exactly that
 * identity and key is removed, so a slow caller cannot erase a session
 * another tab saved since; without it the session goes unconditionally and
 * the marker is dropped first.
 */
export async function clearWalletSession(match?: {
  identityId: string;
  keyId: number;
}): Promise<void> {
  if (!match) {
    writeMarker(null);
    if (!hasIndexedDb()) return;
    try {
      await withStore("readwrite", (store) => store.delete(SESSION));
    } catch {
      // nothing stored, or storage is gone
    }
    return;
  }
  if (readMarker() === grantTag(match)) writeMarker(null);
  if (!hasIndexedDb()) return;
  await deleteSessionIf(match);
}
