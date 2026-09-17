import type { ReactNode } from "react";
import { shortId } from "../lib/format";

/** Internal navigation for identity references in read-only app content. */
export function IdentityLink({
  id,
  onOpen,
  className,
  children,
}: {
  id: string | null | undefined;
  onOpen: (identityId: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  if (!id) return <span className={className}>—</span>;

  return (
    <button
      type="button"
      className={`identity-link${className ? ` ${className}` : ""}`}
      title={`${id} — view identity`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(id);
      }}
    >
      {children ?? shortId(id)}
    </button>
  );
}
