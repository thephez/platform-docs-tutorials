/**
 * Renders the name a history record refers to.
 *
 * History records carry only a `documentId`, so the label is resolved
 * asynchronously. Until it arrives — or if the document has since been deleted —
 * this falls back to the truncated document ID, clearly marked as such so it is
 * never mistaken for a name or an identity.
 */
import { shortId } from "../lib/format";
import type { NameLabel } from "../hooks/useDocumentLabels";
import { DpnsName } from "./DpnsName";

export function NameCell({
  documentId,
  name,
  onClick,
}: {
  documentId: string;
  name: NameLabel | null;
  onClick?: () => void;
}) {
  if (name) {
    if (onClick) {
      return (
        <button
          type="button"
          className="data-table__cell-name data-table__name-link"
          aria-label={`${name.label}.${name.parentDomainName}`}
          onClick={onClick}
        >
          <DpnsName
            label={name.label}
            parentDomainName={name.parentDomainName}
          />
        </button>
      );
    }

    return (
      <span className="data-table__cell-name">
        <DpnsName label={name.label} parentDomainName={name.parentDomainName} />
      </span>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className="data-table__cell-unresolved data-table__name-link mono"
        title={`Document ${documentId}`}
        onClick={onClick}
      >
        {shortId(documentId)}
      </button>
    );
  }

  return (
    <span
      className="data-table__cell-unresolved mono"
      title={`Document ${documentId}`}
    >
      {shortId(documentId)}
    </span>
  );
}
