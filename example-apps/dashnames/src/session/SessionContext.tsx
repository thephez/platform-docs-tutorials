/**
 * Session provider: SDK connection, optional sign-in, protocol gate, balance.
 *
 * SECRETS: the mnemonic is a `login()` parameter that flows into the
 * IdentityKeyManager closure and nowhere else. It is never held in state, never
 * in a ref, and never written to localStorage.
 *
 * LOAD ANCHOR: the SDK is reached only through the cached dynamic loaders, so no
 * module reachable from App.tsx pulls the ~8 MB bundle onto the boot path.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_NETWORK, isNetwork, type Network } from "../dash/contracts";
import { SessionContext } from "./context";
import { loadNetwork, saveNetwork } from "../dash/listingsStore";
import {
  fetchProtocolStatus,
  UNKNOWN_PROTOCOL_STATUS,
} from "../dash/protocolVersion";
import { loadSdkCore } from "../dash/sdkCore";
import type { DashKeyManager, DashSdk } from "../dash/types";
import { detectSecretShape } from "../lib/detectSecretShape";
import { errorMessage } from "../lib/logger";
import { keyManagerFromKey } from "./keyManagerFromKey";
import type { SessionState, SessionValue } from "./types";

function initialNetwork(): Network {
  const stored = loadNetwork();
  return isNetwork(stored) ? stored : DEFAULT_NETWORK;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() => ({
    status: "idle",
    network: initialNetwork(),
    sdk: null,
    keyManager: null,
    identityId: null,
    identityName: null,
    balance: null,
    protocol: UNKNOWN_PROTOCOL_STATUS,
    error: null,
  }));

  // Guards against a slow connect for network A resolving after the user has
  // already switched to network B.
  const connectionId = useRef(0);
  // Separately guards sign-in: key derivation and identity reads can outlive a
  // network switch unless their completion is tied to the originating session.
  const authenticationId = useRef(0);

  const connect = useCallback(async (network: Network) => {
    const id = ++connectionId.current;
    authenticationId.current += 1;
    setState((prev) => ({
      ...prev,
      status: "connecting",
      sdk: null,
      keyManager: null,
      identityId: null,
      identityName: null,
      balance: null,
      protocol: UNKNOWN_PROTOCOL_STATUS,
      error: null,
    }));

    try {
      const core = await loadSdkCore();
      const sdk = (await core.createClient(network)) as unknown as DashSdk;
      if (connectionId.current !== id) return;

      // Fail closed: if the status read throws, sales stay disabled.
      let protocol = UNKNOWN_PROTOCOL_STATUS;
      try {
        protocol = await fetchProtocolStatus({ sdk });
      } catch {
        protocol = UNKNOWN_PROTOCOL_STATUS;
      }
      if (connectionId.current !== id) return;

      setState((prev) => ({
        ...prev,
        status: "readonly",
        sdk,
        protocol,
        error: null,
      }));
    } catch (err) {
      if (connectionId.current !== id) return;
      setState((prev) => ({
        ...prev,
        status: "error",
        error: errorMessage(err),
      }));
    }
  }, []);

  // Reconnect only when the network changes. `connect` guards its own result
  // against a superseded connection via `connectionId`.
  const network = state.network;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await connect(network);
    })();
    return () => {
      cancelled = true;
    };
  }, [network, connect]);

  const login = useCallback(
    async (
      secret: string,
      options: { identityIndex?: number; expectedIdentityId?: string } = {},
    ) => {
      const sdk = state.sdk;
      const network = state.network;
      if (!sdk) throw new Error("Not connected yet.");
      if (network !== "testnet") {
        throw new Error(
          "Sign-in is disabled on mainnet. Switch to testnet to use an identity.",
        );
      }
      const trimmed = secret.trim();
      if (!trimmed)
        throw new Error("Recovery phrase or private key is required.");
      const id = ++authenticationId.current;
      const assertCurrent = () => {
        if (authenticationId.current !== id) {
          throw new Error("Sign-in was cancelled because the network changed.");
        }
      };

      const shape = detectSecretShape(trimmed);
      let keyManager: DashKeyManager;
      if (shape === "mnemonic") {
        const core = await loadSdkCore();
        assertCurrent();
        keyManager = (await core.IdentityKeyManager.create({
          sdk,
          mnemonic: trimmed,
          network,
          identityIndex: options.identityIndex ?? 0,
        })) as unknown as DashKeyManager;
      } else {
        const { loginWithPrivateKey } =
          await import("../dash/loginWithPrivateKey");
        assertCurrent();
        const auth = await loginWithPrivateKey(
          sdk,
          trimmed,
          options.expectedIdentityId,
        );
        keyManager = keyManagerFromKey(auth.identityId, auth);
      }
      assertCurrent();

      const identityId = keyManager.identityId ?? null;
      if (!identityId) {
        throw new Error(
          "No identity found for that recovery phrase on this network.",
        );
      }

      const [balance, identityName] = await Promise.all([
        sdk.identities.balance(identityId).catch(() => null),
        sdk.dpns.username(identityId).catch(() => null),
      ]);
      assertCurrent();

      setState((prev) => ({
        ...(prev.network === network && prev.sdk === sdk
          ? {
              ...prev,
              status: "authenticated" as const,
              keyManager,
              identityId,
              identityName: identityName ?? null,
              balance,
              error: null,
            }
          : prev),
      }));
    },
    [state.sdk, state.network],
  );

  const logout = useCallback(() => {
    authenticationId.current += 1;
    setState((prev) => ({
      ...prev,
      status: prev.sdk ? "readonly" : "idle",
      keyManager: null,
      identityId: null,
      identityName: null,
      balance: null,
    }));
  }, []);

  const setNetwork = useCallback((network: Network) => {
    authenticationId.current += 1;
    connectionId.current += 1;
    saveNetwork(network);
    setState((prev) => {
      if (prev.network === network) return prev;
      return {
        ...prev,
        network,
        status: "idle",
        sdk: null,
        keyManager: null,
        identityId: null,
        identityName: null,
        balance: null,
        protocol: UNKNOWN_PROTOCOL_STATUS,
        error: null,
      };
    });
  }, []);

  const refreshBalance = useCallback(async () => {
    const { sdk, identityId } = state;
    if (!sdk || !identityId) return;
    try {
      const balance = await sdk.identities.balance(identityId);
      setState((prev) =>
        prev.identityId === identityId ? { ...prev, balance } : prev,
      );
    } catch {
      // A failed balance refresh leaves the previous figure in place.
    }
  }, [state]);

  const value = useMemo<SessionValue>(
    () => ({ ...state, login, logout, setNetwork, refreshBalance }),
    [state, login, logout, setNetwork, refreshBalance],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
