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
}: {
  documentId: string;
  name: NameLabel | null;
}) {
  if (name) {
    return (
      <span className="data-table__cell-name">
        <DpnsName label={name.label} parentDomainName={name.parentDomainName} />
      </span>
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
