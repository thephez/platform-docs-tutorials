import type {
  Identity,
  IdentityPublicKey,
  IdentitySigner,
} from "@dashevo/evo-sdk";
import type { DocumentHandle } from "../lib/safeDoc";

export interface DashAuth {
  identity: Identity;
  identityKey: IdentityPublicKey | undefined;
  signer: IdentitySigner;
}

export interface DashKeyManager {
  readonly identityId: string | null | undefined;
  getAuth(): Promise<DashAuth>;
}

export type DashQueryResults =
  | DocumentHandle[]
  | Map<string, DocumentHandle | undefined>
  | Record<string, DocumentHandle | undefined>;

export type WhereClause = [string, string, unknown];
export type OrderByClause = [string, "asc" | "desc"];

export interface DocumentQueryArgs {
  dataContractId: string;
  documentTypeName: string;
  where?: unknown[][];
  orderBy?: OrderByClause[];
  limit?: number;
  startAfter?: string;
}

export interface AggregateQueryArgs {
  dataContractId: string;
  documentTypeName: string;
  where?: unknown[][];
  orderBy?: OrderByClause[];
  groupBy?: string[];
}

/**
 * The narrow slice of the SDK this app uses. Structural, so the real `EvoSDK`
 * satisfies it and tests can pass a stub.
 */
export interface DashSdk {
  /** Protocol version negotiated with the network. */
  version(): number;
  system: {
    status(): Promise<unknown>;
  };
  documents: {
    query(args: DocumentQueryArgs): Promise<DashQueryResults>;
    get(
      contractId: string,
      documentTypeName: string,
      documentId: string,
    ): Promise<DocumentHandle | undefined>;
    count(args: AggregateQueryArgs): Promise<Map<string, bigint>>;
    sum(
      args: AggregateQueryArgs,
      sumProperty: string,
    ): Promise<Map<string, bigint>>;
    average(
      args: AggregateQueryArgs,
      averageProperty: string,
    ): Promise<Map<string, { count: bigint; sum: bigint }>>;
    setPrice(args: {
      document: DocumentHandle | undefined;
      price: bigint;
      identityKey: IdentityPublicKey | undefined;
      signer: IdentitySigner;
    }): Promise<unknown>;
    purchase(args: {
      document: DocumentHandle | undefined;
      buyerId: Identity["id"] | string;
      price: bigint;
      identityKey: IdentityPublicKey | undefined;
      signer: IdentitySigner;
    }): Promise<unknown>;
    transfer(args: {
      document: DocumentHandle | undefined;
      recipientId: string;
      identityKey: IdentityPublicKey | undefined;
      signer: IdentitySigner;
    }): Promise<unknown>;
  };
  identities: {
    balance(identityId: string): Promise<bigint>;
  };
  dpns: {
    username(identityId: string): Promise<string | null | undefined>;
    resolveName(name: string): Promise<string | null | undefined>;
    /** DPNS's homograph fold (`l`/`i` -> `1`, `o` -> `0`). Async: WASM init. */
    convertToHomographSafe(input: string): Promise<string>;
  };
}
