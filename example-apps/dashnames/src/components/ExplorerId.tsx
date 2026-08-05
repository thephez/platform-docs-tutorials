import type { ReactNode } from "react";
import type { Network } from "../dash/contracts";
import { explorerUrl, type ExplorerKind } from "../lib/explorer";
import { shortId } from "../lib/format";

export function ExplorerId({
  network,
  kind,
  id,
  className,
  children,
}: {
  network: Network;
  kind: ExplorerKind;
  id: string | null | undefined;
  className?: string;
  children?: ReactNode;
}) {
  if (!id) return <span className={className}>—</span>;

  return (
    <a
      className={`explorer-link${className ? ` ${className}` : ""}`}
      href={explorerUrl(network, kind, id)}
      target="_blank"
      rel="noreferrer"
      title={`${id} — view on Platform Explorer`}
    >
      {children ?? shortId(id)}
    </a>
  );
}
