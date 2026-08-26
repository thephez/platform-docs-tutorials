/**
 * Activity feed: every listing, sale, transfer, and delist since
 * protocol v13, with an event-type filter.
 *
 * Events are grouped by calendar day. Amount is an em-dash for transfers and
 * delists, matching the design.
 */
import {
  activityKind,
  isSelfTransfer,
  type ActivityKind,
  type HistoryEvent,
} from "../dash/listingTypes";
import type { NameLabel } from "../hooks/useDocumentLabels";
import { formatBlock } from "../lib/format";
import { IdentityLink } from "./IdentityLink";
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
      return kind === "LISTED";
    case "transfers":
      return kind === "TRANSFER";
    default:
      return true;
  }
}

function calendarKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  if (calendarKey(timestamp) === calendarKey(now)) return "Today";

  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  yesterday.setDate(yesterday.getDate() - 1);
  if (calendarKey(timestamp) === calendarKey(yesterday.getTime())) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function groupByDay(events: HistoryEvent[]) {
  const groups: Array<{
    key: string;
    label: string;
    events: HistoryEvent[];
  }> = [];

  for (const event of events) {
    const key = calendarKey(event.createdAt);
    const previous = groups.at(-1);
    if (previous?.key === key) previous.events.push(event);
    else {
      groups.push({
        key,
        label: dayLabel(event.createdAt),
        events: [event],
      });
    }
  }

  return groups;
}

const BADGE_CLASS: Record<ActivityKind, string> = {
  SALE: "badge badge--sale",
  LISTED: "badge badge--listed",
  TRANSFER: "badge badge--transfer",
  DELISTED: "badge badge--delisted",
};

const EVENT_LABEL: Record<ActivityKind, string> = {
  SALE: "Sold",
  LISTED: "Listed",
  TRANSFER: "Transferred",
  DELISTED: "Delisted",
};

export function ActivityView({
  events,
  loading,
  filter,
  onFilterChange,
  onOpenDocument,
  lookupName,
  onOpenIdentity,
}: {
  events: HistoryEvent[];
  loading: boolean;
  filter: ActivityFilter;
  onFilterChange: (filter: ActivityFilter) => void;
  onOpenDocument: (documentId: string) => void;
  /** Resolves a record's documentId to its DPNS label. */
  lookupName: (documentId: string) => NameLabel | null;
  onOpenIdentity: (identityId: string) => void;
}) {
  const visible = events.filter((e) => matchesFilter(activityKind(e), filter));
  const groups = groupByDay(visible);
  const filterCounts: Record<ActivityFilter, number> = {
    all: events.length,
    sales: events.filter((event) => activityKind(event) === "SALE").length,
    listings: events.filter((event) => activityKind(event) === "LISTED").length,
    transfers: events.filter((event) => activityKind(event) === "TRANSFER")
      .length,
  };

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
              <span>{f.label}</span>
              <span className="activity-filter__count">
                {filterCounts[f.value]}
              </span>
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
            groups.map((group) => (
              <section className="activity-day" key={group.key}>
                <div className="activity-day__head">
                  <h2>{group.label}</h2>
                  <span>
                    {group.events.length}{" "}
                    {group.events.length === 1 ? "event" : "events"}
                  </span>
                </div>
                {group.events.map((event) => {
                  const kind = activityKind(event);
                  const selfTransfer = isSelfTransfer(event);
                  const showAmount =
                    (kind === "SALE" || kind === "LISTED") &&
                    event.price != null;
                  return (
                    <div
                      key={event.id}
                      className="data-table__row"
                      style={{ gridTemplateColumns: COLUMNS }}
                    >
                      <span>
                        <span className={BADGE_CLASS[kind]}>
                          {EVENT_LABEL[kind]}
                        </span>
                      </span>
                      <NameCell
                        documentId={event.documentId}
                        name={lookupName(event.documentId)}
                        onClick={() => onOpenDocument(event.documentId)}
                      />
                      <span className="align-right">
                        {showAmount && event.price != null ? (
                          <Price
                            credits={event.price}
                            align="right"
                            compactCredits
                            className={`activity-amount activity-amount--${kind.toLowerCase()}`}
                          />
                        ) : (
                          <span className="amount-dash">—</span>
                        )}
                      </span>
                      <span className="data-table__cell-mono">
                        {kind === "SALE" ? (
                          <>
                            <IdentityLink
                              id={event.sellerId}
                              onOpen={onOpenIdentity}
                            />{" "}
                            →{" "}
                            <IdentityLink
                              id={event.ownerId}
                              onOpen={onOpenIdentity}
                            />
                          </>
                        ) : kind === "TRANSFER" ? (
                          selfTransfer ? (
                            <>
                              <IdentityLink
                                id={event.ownerId}
                                onOpen={onOpenIdentity}
                              />{" "}
                              <span
                                className="self-transfer-marker"
                                title="Some wallets delist by transferring a name to its current owner. This clears any active listing."
                              >
                                to self
                              </span>
                            </>
                          ) : (
                            <>
                              <IdentityLink
                                id={event.ownerId}
                                onOpen={onOpenIdentity}
                              />{" "}
                              →{" "}
                              <IdentityLink
                                id={event.toIdentityId}
                                onOpen={onOpenIdentity}
                              />
                            </>
                          )
                        ) : (
                          <IdentityLink
                            id={event.ownerId}
                            onOpen={onOpenIdentity}
                          />
                        )}
                      </span>
                      <span className="data-table__cell-meta align-right">
                        {formatBlock(event.createdAtBlockHeight)}
                      </span>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>

      <p className="table-footnote">
        A delisting is a zero-price update; sales and transfers clear any active
        listing without writing one, so they appear under their own event type.
      </p>
    </>
  );
}
