/**
 * Activity feed: every listing, sale, transfer, and delist since
 * protocol v13, with an event-type filter.
 *
 * Amount is an em-dash for transfers and delists, matching the design.
 */
import {
  activityKind,
  type ActivityKind,
  type HistoryEvent,
} from "../dash/listingTypes";
import type { NameLabel } from "../hooks/useDocumentLabels";
import { formatBlock, shortId } from "../lib/format";
import { NameCell } from "./NameCell";
import { Price } from "./Price";
import { SkeletonRows } from "./Skeleton";

const COLUMNS = "110px 1.2fr 1fr 1.4fr .9fr";

export type ActivityFilter = "all" | "sales" | "listings" | "transfers";

const FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "sales", label: "Sales" },
  { value: "listings", label: "Listings" },
  { value: "transfers", label: "Transfers" },
];

function matchesFilter(kind: ActivityKind, filter: ActivityFilter): boolean {
  switch (filter) {
    case "sales":
      return kind === "SALE";
    case "listings":
      return kind === "LISTED" || kind === "DELISTED";
    case "transfers":
      return kind === "TRANSFER";
    default:
      return true;
  }
}

const BADGE_CLASS: Record<ActivityKind, string> = {
  SALE: "badge badge--sale",
  LISTED: "badge badge--listed",
  TRANSFER: "badge badge--transfer",
  DELISTED: "badge badge--delisted",
};

export function ActivityView({
  events,
  loading,
  filter,
  onFilterChange,
  onOpenDocument,
  lookupName,
}: {
  events: HistoryEvent[];
  loading: boolean;
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
  onOpenDocument: (documentId: string) => void;
  /** Resolves a record's documentId to its DPNS label. */
  lookupName: (documentId: string) => NameLabel | null;
}) {
  const visible = events.filter((e) => matchesFilter(activityKind(e), filter));

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-head__title">Activity</h1>
          <p className="page-head__sub">
            Every listing, sale, and transfer recorded by the protocol since v13
          </p>
        </div>
        <div className="activity-filters">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`activity-filter${filter === f.value ? " activity-filter--active" : ""}`}
              aria-pressed={filter === f.value}
              onClick={() => onFilterChange(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <div className="data-table data-table--activity">
          <div
            className="data-table__row data-table__row--head"
            style={{ gridTemplateColumns: COLUMNS }}
          >
            <span className="label-caps">Event</span>
            <span className="label-caps">Name</span>
            <span className="label-caps align-right">Amount</span>
            <span className="label-caps">Parties</span>
            <span className="label-caps align-right">Block</span>
          </div>

          {loading && events.length === 0 ? (
            <SkeletonRows count={5} />
          ) : visible.length === 0 ? (
            <p className="empty-state">
              No activity recorded on this network yet. History starts at
              protocol v13.
            </p>
          ) : (
            visible.map((event) => {
              const kind = activityKind(event);
              const showAmount =
                (kind === "SALE" || kind === "LISTED") && event.price != null;
              return (
                <button
                  key={event.id}
                  type="button"
                  className="data-table__row data-table__row--clickable"
                  style={{ gridTemplateColumns: COLUMNS }}
                  onClick={() => onOpenDocument(event.documentId)}
                >
                  <span>
                    <span className={BADGE_CLASS[kind]}>{kind}</span>
                  </span>
                  <NameCell
                    documentId={event.documentId}
                    name={lookupName(event.documentId)}
                  />
                  <span className="align-right">
                    {showAmount && event.price != null ? (
                      <Price
                        credits={event.price}
                        align="right"
                        compactCredits
                      />
                    ) : (
                      <span className="amount-dash">—</span>
                    )}
                  </span>
                  <span className="data-table__cell-mono">
                    {kind === "SALE"
                      ? `${shortId(event.sellerId)} → ${shortId(event.ownerId)}`
                      : kind === "TRANSFER"
                        ? `${shortId(event.ownerId)} → ${shortId(event.toIdentityId)}`
                        : shortId(event.ownerId)}
                  </span>
                  <span className="data-table__cell-meta align-right">
                    {formatBlock(event.createdAtBlockHeight)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <p className="table-footnote">
        Delisting shows as a zero-price update. Sales and transfers clear the
        price without one, so they are shown by their own event type.
      </p>
    </>
  );
}
