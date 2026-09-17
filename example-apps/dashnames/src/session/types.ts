import type { Network } from "../dash/contracts";
import type { ProtocolStatus } from "../dash/protocolVersion";
import type { DashKeyManager, DashSdk } from "../dash/types";

export type SessionStatus =
  "idle" | "connecting" | "readonly" | "authenticated" | "error";

export interface SessionState {
  status: SessionStatus;
  network: Network;
  sdk: DashSdk | null;
  /** Null in read-only mode — every write path must check this first. */
  keyManager: DashKeyManager | null;
  identityId: string | null;
  /** DPNS name of the signed-in identity, when it has one. */
  identityName: string | null;
  /** Live credit balance of the signed-in identity. */
  balance: bigint | null;
  protocol: ProtocolStatus;
  error: string | null;
}

export interface SessionValue extends SessionState {
  /** Signs in. The secret is a parameter only — it is never stored in state. */
  login(
    secret: string,
    options?: { identityIndex?: number; expectedIdentityId?: string },
  ): Promise<void>;
  logout(): void;
  setNetwork(network: Network): void;
  refreshBalance(): Promise<void>;
}
