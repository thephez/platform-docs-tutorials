import type { Network } from "../dash/contracts";

export type ExplorerKind = "identity" | "document";

export function explorerUrl(
  network: Network,
  kind: ExplorerKind,
  id: string,
): string {
  const base =
    network === "testnet"
      ? "https://testnet.platform-explorer.com"
      : "https://platform-explorer.com";
  return `${base}/${kind}/${id}`;
}
