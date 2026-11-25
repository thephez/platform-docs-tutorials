import { toast } from "sonner";
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  clearStoredContractId,
  loadStoredContractId,
  refreshContractCache,
  saveContractId,
} from "../dash/contract";
import type { WalletGrant, WalletLogin } from "../dash/appConnect";
import { resolveDpnsName } from "../dash/resolveDpnsName";
import type { DashKeyManager, DashSdk } from "../dash/types";
import { detectSecretShape } from "../lib/detectSecretShape";
import {
  ACTIVITY_LOG_LIMIT,
  errorMessage,
  normalizeLogOptions,
  type LogEntry,
  type Logger,
} from "../lib/logger";
import { clearCachedNotes } from "../lib/notesCache";
import {
  clearRememberedIdentity,
  loadRememberedIdentity,
  saveRememberedIdentity,
} from "../lib/rememberedIdentity";
import {
  clearWalletSession,
  loadWalletSession,
  peekWalletSession,
  type StoredWalletSession,
} from "../lib/walletSessionStore";
import { keyManagerFromKey } from "./keyManagerFromKey";

// The SDK + IdentityKeyManager pull in @dashevo/evo-sdk (and its ~8MB WASM
// bundle), so we load them lazily on first use to keep the app shell off
// the critical path. Cached after first call.
type SdkModule = typeof import("../../../../setupDashClient-core.mjs");
let sdkModulePromise: Promise<SdkModule> | null = null;
function loadSdkModule(): Promise<SdkModule> {
  if (!sdkModulePromise) {
    sdkModulePromise = import("../../../../setupDashClient-core.mjs").catch(
      (err) => {
        // Clear the cache on failure so a subsequent connect/login retry
        // can re-attempt the import (e.g., after a transient chunk fetch
        // failure). Without this, every retry would await the same
        // rejected promise and fail immediately.
        sdkModulePromise = null;
        throw err;
      },
    );
  }
  return sdkModulePromise;
}

// appConnect pulls in loginWithPrivateKey and with it @dashevo/evo-sdk, so
// it is only ever loaded on demand, like the WIF path in login().
type AppConnectModule = typeof import("../dash/appConnect");
let appConnectPromise: Promise<AppConnectModule> | null = null;
function loadAppConnect(): Promise<AppConnectModule> {
  if (!appConnectPromise) {
    appConnectPromise = import("../dash/appConnect").catch((err) => {
      appConnectPromise = null;
      throw err;
    });
  }
  return appConnectPromise;
}

// A dead testnet node otherwise costs the browser's 20-second connect
// timeout per attempt, which stalls the wallet sign-in's polling.
const CONNECTION_OPTIONS = { settings: { connectTimeoutMs: 5_000 } };

function forgetStoredWalletSession(match?: {
  identityId: string;
  keyId: number;
}) {
  void clearWalletSession(match).catch(() => {});
}

export type SessionStatus =
  | "idle"
  | "connecting"
  | "readonly"
  | "browsing"
  | "authenticated"
  | "error";

export interface LoginOptions {
  identityIndex?: number;
  rememberMe?: boolean;
  expectedIdentityId?: string;
}

export type WalletNotice = "renew";

export interface WalletLoginOptions {
  rememberMe?: boolean;
  /** The wallet's key was kept on this device; implies rememberMe. */
  staySignedIn?: boolean;
}

export interface SessionValue {
  status: SessionStatus;
  error: string | null;
  sdk: DashSdk | null;
  keyManager: DashKeyManager | null;
  identityId: string | null;
  contractId: string | null;
  rememberedIdentityId: string | null;
  dpnsName: string | null;
  walletGrant: WalletGrant | null;
  walletNotice: WalletNotice | null;
  /** The wallet session survives a reload on this device. */
  walletSessionKept: boolean;
  /** A kept wallet session is being restored; boot waits for it. */
  restoringWallet: boolean;
  setContractId: (id: string | null) => void;
  log: Logger;
  activityLog: LogEntry[];
  clearActivityLog: () => void;
  login: (secret: string, options?: LoginOptions) => Promise<void>;
  loginWithWallet: (
    login: WalletLogin,
    options?: WalletLoginOptions,
  ) => Promise<void>;
  refreshWalletGrant: () => Promise<void>;
  reportWriteError: (err: unknown) => Promise<"renew" | "logout" | null>;
  dismissWalletNotice: () => void;
  enterReadOnly: () => Promise<void>;
  viewAsRemembered: () => Promise<void>;
  forgetIdentity: () => void;
  logout: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);
export { SessionContext };

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialRemembered = loadRememberedIdentity();
  const [status, setStatus] = useState<SessionStatus>(
    initialRemembered ? "browsing" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [sdk, setSdk] = useState<DashSdk | null>(null);
  const [keyManager, setKeyManager] = useState<DashKeyManager | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(
    initialRemembered?.id ?? null,
  );
  const [contractId, setContractIdState] = useState<string | null>(() =>
    loadStoredContractId(),
  );
  // The restore runs in a mount effect and must see a later switch.
  const contractIdRef = useRef(contractId);
  const [rememberedIdentityId, setRememberedIdentityId] = useState<
    string | null
  >(initialRemembered?.id ?? null);
  const [dpnsName, setDpnsName] = useState<string | null>(
    initialRemembered?.name ?? null,
  );

  const [walletGrant, setWalletGrant] = useState<WalletGrant | null>(null);
  const [walletNotice, setWalletNotice] = useState<WalletNotice | null>(null);
  const [walletSessionKept, setWalletSessionKept] = useState(false);
  // Only a remembered identity can have a session to restore, so without
  // one the boot never waits.
  const [restoringWallet, setRestoringWallet] = useState(
    initialRemembered !== null,
  );
  // Bumped by every sign-in and sign-out, so a restore still in flight
  // can tell the session moved on without it.
  const sessionEpochRef = useRef(0);

  // The grant a late wallet read, write error or contract switch may still
  // act on. Kept in step with the state synchronously, so nothing that
  // started under another identity or key can slip in before a render.
  const walletKeyRef = useRef<{
    identityId: string;
    keyId: number;
    contractId: string;
  } | null>(null);
  const applyWalletGrant = useCallback(
    (grant: WalletGrant | null, forIdentityId: string | null) => {
      walletKeyRef.current =
        grant && forIdentityId
          ? {
              identityId: forIdentityId,
              keyId: grant.keyId,
              contractId: grant.contractId,
            }
          : null;
      setWalletGrant(grant);
    },
    [],
  );

  const [activityLog, setActivityLog] = useState<LogEntry[]>([]);

  const log = useCallback<Logger>((message, levelOrOptions) => {
    const { level = "info", detail } = normalizeLogOptions(levelOrOptions);
    const method =
      level === "error" ? "error" : level === "success" ? "info" : "log";
    console[method](`[${level}] ${message}${detail ? ` (${detail})` : ""}`);
    const entry: LogEntry = {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      level,
      message,
      detail,
      timestamp: Date.now(),
    };
    setActivityLog((prev) => {
      const next = [entry, ...prev];
      return next.length > ACTIVITY_LOG_LIMIT
        ? next.slice(0, ACTIVITY_LOG_LIMIT)
        : next;
    });
    if (level === "success") toast.success(message);
    if (level === "error") toast.error(message);
  }, []);

  const clearActivityLog = useCallback(() => setActivityLog([]), []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    log("Connecting to Dash Platform testnet…", {
      level: "info",
      detail: 'createClient("testnet")',
    });
    const { createClient } = await loadSdkModule();
    const connected = (await createClient(
      "testnet",
      CONNECTION_OPTIONS,
    )) as unknown as DashSdk;
    setSdk(connected);
    log("Connected to Dash Platform testnet.", {
      level: "info",
      detail: "sdk.connect",
    });
    return connected;
  }, [log]);

  // Everything after a key manager is in hand (DPNS caption, remember-me)
  // is the same whether the key came from a mnemonic, a WIF, a wallet grant
  // or a wallet session kept from an earlier load.
  const enterAuthenticated = useCallback(
    async (
      connected: DashSdk,
      resolvedKeyManager: DashKeyManager,
      detail: string,
      {
        rememberMe,
        grant,
        kept = false,
        notice = null,
        restoring = false,
      }: {
        rememberMe: boolean;
        grant: WalletGrant | null;
        kept?: boolean;
        notice?: WalletNotice | null;
        restoring?: boolean;
      },
    ) => {
      // A logout, forget or newer sign-in during the DPNS lookup below
      // bumps the epoch; the rest of this sign-in then stops.
      const epoch = sessionEpochRef.current;
      const rememberedBefore = loadRememberedIdentity()?.id ?? null;
      setKeyManager(resolvedKeyManager);
      const resolvedId = resolvedKeyManager.identityId ?? null;
      applyWalletGrant(grant, resolvedId);
      setWalletNotice(notice);
      setWalletSessionKept(kept);
      // A pasted key replaces any wallet session kept on this device.
      if (!grant) forgetStoredWalletSession();
      setIdentityId(resolvedId ?? null);
      setStatus("authenticated");
      log(`Identity resolved: ${resolvedId ?? "(unknown)"}`, {
        level: "success",
        detail,
      });

      // Resolve the DPNS name after auth so we can persist it alongside
      // the identity ID — DPNS bindings are permanent, so what we save
      // here is correct for every future load. A naming-service failure
      // shouldn't kill an otherwise-valid session: caption is optional.
      let resolvedName: string | null = null;
      if (resolvedId) {
        try {
          resolvedName = await resolveDpnsName(connected, resolvedId);
        } catch (dpnsErr) {
          log(`DPNS lookup failed: ${errorMessage(dpnsErr)}`, "info");
        }
        if (sessionEpochRef.current !== epoch) return;
        setDpnsName(resolvedName);
      }
      if (rememberMe && resolvedId) {
        // Another tab may have remembered someone else, or forgotten the
        // identity a restore relied on, during the lookup; theirs stands.
        const rememberedNow = loadRememberedIdentity()?.id ?? null;
        const changedElsewhere =
          rememberedNow !== rememberedBefore && rememberedNow !== resolvedId;
        if (changedElsewhere && (rememberedNow !== null || restoring)) return;
        saveRememberedIdentity({ id: resolvedId, name: resolvedName });
        setRememberedIdentityId(resolvedId);
      } else {
        const rememberedNow = loadRememberedIdentity()?.id ?? null;
        if (rememberedNow !== null && rememberedNow !== rememberedBefore) {
          // Another tab remembered someone during the lookup; theirs stands.
          setRememberedIdentityId(rememberedNow);
          return;
        }
        clearRememberedIdentity();
        setRememberedIdentityId(null);
      }
    },
    [log, applyWalletGrant],
  );

  // Shared by every sign-in path: `resolve` turns a connected SDK into a key
  // manager; a failure restores the session the user had before.
  const authenticate = useCallback(
    async (
      resolve: (
        connected: DashSdk,
      ) => Promise<{ keyManager: DashKeyManager; detail: string }>,
      options: {
        rememberMe: boolean;
        grant: WalletGrant | null;
        kept?: boolean;
      },
    ) => {
      // Snapshot session state so a failed login can restore the user's
      // prior context instead of clobbering it. Without this, mistyping a
      // key while in browsing/authenticated mode silently logs the user out.
      const priorStatus = status;
      const priorKeyManager = keyManager;
      const priorIdentityId = identityId;
      const priorDpnsName = dpnsName;
      const priorWalletGrant = walletGrant;
      const priorWalletNotice = walletNotice;
      sessionEpochRef.current += 1;
      setError(null);
      try {
        const connected = sdk ?? (await connect());
        const { keyManager: resolvedKeyManager, detail } =
          await resolve(connected);
        await enterAuthenticated(
          connected,
          resolvedKeyManager,
          detail,
          options,
        );
      } catch (err) {
        const message = errorMessage(err);
        setError(message);
        // Restore prior session state. If the user was already authenticated
        // (e.g. they opened Settings and pasted a bad secret), keep them
        // logged in — a typo shouldn't demote an active session. Otherwise,
        // prefer landing in browsing mode if a remembered identity exists,
        // so a failed key-swap still shows the remembered identity panel
        // instead of the logged-out form.
        const remembered = loadRememberedIdentity();
        if (priorStatus === "authenticated" && priorKeyManager) {
          setKeyManager(priorKeyManager);
          setIdentityId(priorIdentityId);
          setDpnsName(priorDpnsName);
          applyWalletGrant(priorWalletGrant, priorIdentityId);
          setWalletNotice(priorWalletNotice);
          setStatus(priorStatus);
        } else if (remembered) {
          setKeyManager(null);
          setIdentityId(remembered.id);
          setDpnsName(remembered.name ?? null);
          applyWalletGrant(null, null);
          setWalletNotice(null);
          setStatus("browsing");
        } else {
          setKeyManager(priorKeyManager);
          setIdentityId(priorIdentityId);
          setDpnsName(priorDpnsName);
          applyWalletGrant(priorWalletGrant, priorIdentityId);
          setWalletNotice(priorWalletNotice);
          setStatus(priorStatus);
        }
        log(`Login failed: ${message}`, "error");
        throw err;
      }
    },
    [
      sdk,
      status,
      keyManager,
      identityId,
      dpnsName,
      walletGrant,
      walletNotice,
      connect,
      log,
      applyWalletGrant,
      enterAuthenticated,
    ],
  );

  const login = useCallback(
    async (secret: string, options: LoginOptions = {}) => {
      const {
        identityIndex = 0,
        rememberMe = false,
        expectedIdentityId,
      } = options;
      const trimmed = secret.trim();
      if (!trimmed) throw new Error("Secret is required.");
      await authenticate(
        async (connected) => {
          // Detect whether the user pasted a mnemonic or a WIF private key
          // and dispatch accordingly. identityIndex only applies to mnemonic
          // input (DIP-13 derivation); a single WIF identifies one key
          // directly so the index is irrelevant in that path.
          const shape = detectSecretShape(trimmed);
          if (shape === "mnemonic") {
            const { IdentityKeyManager } = await loadSdkModule();
            const resolved = (await IdentityKeyManager.create({
              sdk: connected as never,
              mnemonic: trimmed,
              network: "testnet",
              identityIndex,
            })) as unknown as DashKeyManager;
            return {
              keyManager: resolved,
              detail: "IdentityKeyManager.create",
            };
          }
          // Dynamic import keeps loginWithPrivateKey (and its transitive
          // @dashevo/evo-sdk dependency) out of the app shell. The mnemonic
          // branch already pays the SDK fetch via loadSdkModule(); for WIF
          // we fetch this module on first use here.
          const { loginWithPrivateKey } =
            await import("../dash/loginWithPrivateKey");
          const auth = await loginWithPrivateKey(
            connected,
            trimmed,
            expectedIdentityId,
          );
          return {
            keyManager: keyManagerFromKey(auth.identityId, auth),
            detail: "loginWithPrivateKey",
          };
        },
        { rememberMe, grant: null },
      );
    },
    [authenticate],
  );

  const loginWithWallet = useCallback(
    async (walletLogin: WalletLogin, options: WalletLoginOptions = {}) => {
      const staySignedIn = options.staySignedIn ?? false;
      await authenticate(
        async () => ({
          keyManager: keyManagerFromKey(
            walletLogin.identityId,
            walletLogin.auth,
          ),
          detail: "loginWithWalletAnswer",
        }),
        {
          rememberMe: (options.rememberMe ?? false) || staySignedIn,
          grant: walletLogin.grant,
          kept: staySignedIn,
        },
      );
    },
    [authenticate],
  );

  const enterReadOnly = useCallback(async () => {
    setError(null);
    try {
      if (!sdk) await connect();
      setKeyManager(null);
      setIdentityId(null);
      setDpnsName(null);
      setStatus("readonly");
      log("Read-only mode enabled.");
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setStatus("error");
      log(`Connection failed: ${message}`, "error");
    }
  }, [sdk, connect, log]);

  const viewAsRemembered = useCallback(async () => {
    const remembered = loadRememberedIdentity();
    if (!remembered) {
      await enterReadOnly();
      return;
    }
    setError(null);
    setKeyManager(null);
    setIdentityId(remembered.id);
    setRememberedIdentityId(remembered.id);
    setDpnsName(remembered.name ?? null);
    setStatus("browsing");
    try {
      let connected = sdk;
      if (!connected) {
        log("Connecting to Dash Platform testnet…");
        const { createClient } = await loadSdkModule();
        connected = (await createClient(
          "testnet",
          CONNECTION_OPTIONS,
        )) as unknown as DashSdk;
        setSdk(connected);
        log("Connected to Dash Platform testnet.");
      }
      log(`Browsing notes for ${remembered.id} (read-only).`);

      // DPNS (name, identityId) bindings are permanent, so a cached name
      // never needs revalidation. Only resolve when we don't have one yet
      // (e.g. the identity registered a name after we last saved, or this
      // record predates the dpnsName field).
      if (!remembered.name) {
        try {
          const fresh = await resolveDpnsName(connected, remembered.id);
          if (fresh) {
            setDpnsName(fresh);
            saveRememberedIdentity({ id: remembered.id, name: fresh });
          }
        } catch (dpnsErr) {
          log(`DPNS lookup failed: ${errorMessage(dpnsErr)}`, "info");
        }
      }
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setStatus("error");
      log(`Connection failed: ${message}`, "error");
    }
  }, [sdk, enterReadOnly, log]);

  const forgetIdentity = useCallback(() => {
    if (rememberedIdentityId) clearCachedNotes(rememberedIdentityId);
    clearRememberedIdentity();
    setRememberedIdentityId(null);
    // A kept wallet session only restores for the remembered identity.
    sessionEpochRef.current += 1;
    forgetStoredWalletSession();
    setWalletSessionKept(false);
    setDpnsName(null);
    if (status === "browsing") {
      setKeyManager(null);
      setIdentityId(null);
      setStatus(sdk ? "readonly" : "idle");
    }
    log("Forgot remembered identity on this device.");
  }, [status, sdk, rememberedIdentityId, log]);

  const logout = useCallback(() => {
    sessionEpochRef.current += 1;
    forgetStoredWalletSession();
    setWalletSessionKept(false);
    setKeyManager(null);
    applyWalletGrant(null, null);
    setWalletNotice(null);
    setError(null);
    if (rememberedIdentityId) {
      setIdentityId(rememberedIdentityId);
      setStatus(sdk ? "browsing" : "idle");
      log("Logged out. Browsing remembered identity (read-only).");
      return;
    }
    setIdentityId(null);
    setDpnsName(null);
    setStatus(sdk ? "readonly" : "idle");
    log("Logged out.");
  }, [sdk, rememberedIdentityId, log, applyWalletGrant]);

  // A wallet session kept on this device signs back in on load, but only
  // for the remembered identity and the contract its key is bound to.
  const restoreStartedRef = useRef(false);
  useEffect(() => {
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const epoch = sessionEpochRef.current;
    const current = () => sessionEpochRef.current === epoch;

    async function restore(stored: StoredWalletSession) {
      let connected: DashSdk | null = null;
      let privateKey: Uint8Array | null = null;
      // Browses whoever is remembered now, which another tab may have changed.
      const browseRemembered = () => {
        const remembered = loadRememberedIdentity();
        setKeyManager(null);
        setIdentityId(remembered?.id ?? null);
        setRememberedIdentityId(remembered?.id ?? null);
        setDpnsName(remembered?.name ?? null);
        setStatus(remembered ? "browsing" : connected ? "readonly" : "idle");
      };
      try {
        connected = await connect();
        if (!current()) return;
        const loaded = await loadWalletSession();
        if (!current()) {
          loaded?.privateKey.fill(0);
          return;
        }
        // A null load means the store already dropped a record that would
        // not open; a record for someone else is another tab's to keep.
        if (!loaded || loaded.session.identityId !== stored.identityId) {
          loaded?.privateKey.fill(0);
          if (!loaded) {
            log("Your wallet key is no longer valid. Sign in again.");
          }
          browseRemembered();
          return;
        }
        privateKey = loaded.privateKey;
        const { restoreWalletLogin } = await loadAppConnect();
        const key = {
          identityId: loaded.session.identityId,
          keyId: loaded.session.keyId,
          contractId: loaded.session.contractId,
        };
        // restoreWalletLogin wipes the bytes whatever happens.
        const handed = privateKey;
        privateKey = null;
        const restored = await restoreWalletLogin(connected, key, handed);
        if (!current()) return;
        if (!restored) {
          forgetStoredWalletSession({
            identityId: key.identityId,
            keyId: key.keyId,
          });
          log("Your wallet key is no longer valid. Sign in again.");
          browseRemembered();
          return;
        }
        const latest = await peekWalletSession();
        if (!current()) return;
        // Another tab may have signed in as someone else, logged out,
        // forgotten the identity or switched contract during the chain read.
        // The store is then theirs to manage; this tab just doesn't sign in.
        if (
          loadRememberedIdentity()?.id !== key.identityId ||
          latest?.identityId !== key.identityId ||
          latest.keyId !== key.keyId
        ) {
          browseRemembered();
          return;
        }
        if (
          contractIdRef.current !== key.contractId ||
          loadStoredContractId() !== key.contractId
        ) {
          log(
            "Your wallet key is bound to the previous contract. Sign in again to use this one.",
          );
          browseRemembered();
          return;
        }
        await enterAuthenticated(
          connected,
          keyManagerFromKey(restored.login.identityId, restored.login.auth),
          "restoreWalletLogin",
          {
            rememberMe: true,
            grant: restored.login.grant,
            kept: true,
            notice: restored.renewNeeded ? "renew" : null,
            restoring: true,
          },
        );
      } catch (err) {
        privateKey?.fill(0);
        if (!current()) return;
        // Kept for the next load: a network failure says nothing about the key.
        log(`Couldn't restore the wallet session: ${errorMessage(err)}`);
        browseRemembered();
      }
    }

    void (async () => {
      let stored: StoredWalletSession | null = null;
      try {
        stored = await peekWalletSession();
      } catch {
        stored = null;
      }
      const remembered = loadRememberedIdentity();
      // Nothing remembered yet: another tab may still be finishing the
      // sign-in that saved this record, so it is left alone and not used.
      if (stored && !remembered) stored = null;
      if (
        stored &&
        (stored.identityId !== remembered?.id ||
          stored.contractId !== loadStoredContractId())
      ) {
        forgetStoredWalletSession({
          identityId: stored.identityId,
          keyId: stored.keyId,
        });
        stored = null;
      }
      // Matches the shared contract, so this tab is the stale one.
      if (stored && stored.contractId !== contractIdRef.current) {
        stored = null;
      }
      try {
        if (stored && current()) await restore(stored);
      } finally {
        setRestoringWallet(false);
      }
    })();
  }, [connect, log, enterAuthenticated]);

  const setContractId = useCallback(
    (id: string | null) => {
      const trimmed = id?.trim() ?? "";
      // Evict the SDK's cached schema for the contract we're leaving so the
      // next query refetches against the new ID. queries.ts trusts the cache
      // for normal note operations; this is the one place it can become
      // stale (user pastes a different ID or registers a fresh contract).
      const previousId = contractId;
      if (sdk && previousId && previousId !== trimmed) {
        void refreshContractCache({ sdk, contractId: previousId });
      }
      let nextId: string | null = trimmed;
      if (trimmed) {
        saveContractId(trimmed);
      } else {
        clearStoredContractId();
        nextId = loadStoredContractId();
      }
      setContractIdState(nextId);
      contractIdRef.current = nextId;
      // A wallet key can only write to the contract it was issued for. The
      // ref, not the closure: a registration started under a mnemonic may
      // finish after a wallet sign-in and call an older setContractId.
      const wallet = walletKeyRef.current;
      if (wallet && nextId !== previousId && nextId !== wallet.contractId) {
        log(
          "Your wallet key is bound to the previous contract. Sign in again to use this one.",
          "error",
        );
        logout();
      }
    },
    [sdk, contractId, log, logout],
  );

  const isCurrentWalletKey = useCallback(
    (origin: { identityId: string; keyId: number }) =>
      walletKeyRef.current?.identityId === origin.identityId &&
      walletKeyRef.current.keyId === origin.keyId,
    [],
  );

  const refreshWalletGrant = useCallback(async () => {
    if (!walletGrant || !identityId || !sdk) return;
    const origin = { identityId, keyId: walletGrant.keyId };
    try {
      const { readWalletGrant } = await loadAppConnect();
      const fresh = await readWalletGrant(sdk, identityId, origin.keyId);
      if (!isCurrentWalletKey(origin)) return;
      if (!fresh) {
        log("Your wallet disabled this key.", "error");
        logout();
        return;
      }
      applyWalletGrant(fresh, origin.identityId);
    } catch (err) {
      if (!isCurrentWalletKey(origin)) return;
      log(`Couldn't refresh the wallet connection: ${errorMessage(err)}`, {
        level: "error",
        detail: "readWalletGrant",
      });
    }
  }, [
    walletGrant,
    identityId,
    sdk,
    log,
    logout,
    isCurrentWalletKey,
    applyWalletGrant,
  ]);

  const reportWriteError = useCallback(
    async (err: unknown): Promise<"renew" | "logout" | null> => {
      if (!walletGrant || !identityId) return null;
      const origin = { identityId, keyId: walletGrant.keyId };
      let action: "renew" | "logout" | null;
      try {
        const { classifyWalletWriteError } = await loadAppConnect();
        action = classifyWalletWriteError(err);
      } catch {
        // The write error is already on screen; nothing more to add.
        return null;
      }
      if (!isCurrentWalletKey(origin)) return null;
      if (action === "renew") {
        setWalletNotice("renew");
        log(
          "This note needs more than your wallet key has left. Renew the connection in DashPay (Settings → Wallet connection).",
          "error",
        );
      } else if (action === "logout") {
        log("Your wallet revoked this browser's key. Sign in again.", "error");
        logout();
      }
      return action;
    },
    [walletGrant, identityId, log, logout, isCurrentWalletKey],
  );

  const dismissWalletNotice = useCallback(() => setWalletNotice(null), []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      error,
      sdk,
      keyManager,
      identityId,
      contractId,
      rememberedIdentityId,
      dpnsName,
      walletGrant,
      walletNotice,
      walletSessionKept,
      restoringWallet,
      setContractId,
      log,
      activityLog,
      clearActivityLog,
      login,
      loginWithWallet,
      refreshWalletGrant,
      reportWriteError,
      dismissWalletNotice,
      enterReadOnly,
      viewAsRemembered,
      forgetIdentity,
      logout,
    }),
    [
      status,
      error,
      sdk,
      keyManager,
      identityId,
      contractId,
      rememberedIdentityId,
      dpnsName,
      walletGrant,
      walletNotice,
      walletSessionKept,
      restoringWallet,
      setContractId,
      log,
      activityLog,
      clearActivityLog,
      login,
      loginWithWallet,
      refreshWalletGrant,
      reportWriteError,
      dismissWalletNotice,
      enterReadOnly,
      viewAsRemembered,
      forgetIdentity,
      logout,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
