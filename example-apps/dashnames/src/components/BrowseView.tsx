/**
 * Browse all: 210px filter sidebar + results grid at 5 columns.
 */
import type { Listing } from "../dash/listingTypes";
import type { SyncProgress } from "../dash/listingsIndex";
import type { SyncPhase } from "../hooks/useListings";
import {
  applyFilters,
  describeFilters,
  type Filters,
  type ListingHistoryFacts,
  type SortKey,
} from "../lib/filters";
import { FilterSidebar } from "./FilterSidebar";
import { NameTile } from "./NameTile";
import { SkeletonGrid } from "./Skeleton";
import { SyncChip } from "./SyncChip";

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: "priceAsc", label: "Price: low to high" },
  { value: "priceDesc", label: "Price: high to low" },
  { value: "recent", label: "Recently listed" },
  { value: "lengthAsc", label: "Shortest first" },
];

export function BrowseView({
  listings,
  filters,
  onFiltersChange,
  historyFacts,
  syncPhase,
  syncProgress,
  lastSyncedAt,
  stale,
  onOpenListing,
  onBuy,
  onManage,
  canBuy,
  buyerIdentityId,
  onRefresh,
}: {
  listings: Listing[];
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  historyFacts?: Map<string, ListingHistoryFacts>;
  syncPhase: SyncPhase;
  syncProgress: SyncProgress | null;
  lastSyncedAt: number | null;
  stale: boolean;
  onOpenListing: (listing: Listing) => void;
  onBuy: (listing: Listing) => void;
  onManage: (listing: Listing) => void;
  canBuy: boolean;
  buyerIdentityId: string | null;
  onRefresh: () => void;
}) {
  const visible = applyFilters(listings, filters, historyFacts);
  const summary = describeFilters(filters);
  const syncing = syncPhase === "syncing";

  return (
    <div className="browse">
      <FilterSidebar
        filters={filters}
        onChange={onFiltersChange}
        historyRulesEnabled={Boolean(historyFacts)}
      />

      <div>
        <div className="results-toolbar">
          <div>
            <span className="results-toolbar__count">
              {visible.length.toLocaleString("en-US")}{" "}
              {visible.length === 1 ? "name" : "names"} for sale
            </span>
            {summary && (
              <span className="results-toolbar__summary">{summary}</span>
            )}
          </div>
          <div className="results-toolbar__right">
            <SyncChip
              phase={syncPhase}
              progress={syncProgress}
              lastSyncedAt={lastSyncedAt}
              stale={stale}
              onRefresh={onRefresh}
            />
            <select
              className="sort-control"
              value={filters.sort}
              aria-label="Sort listings"
              onChange={(e) =>
                onFiltersChange({ ...filters, sort: e.target.value as SortKey })
              }
            >
              {SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="browse__grid">
          {syncing && listings.length === 0 ? (
            <SkeletonGrid count={10} columns={5} />
          ) : visible.length === 0 ? (
            <p className="empty-state">
              {listings.length === 0
                ? "No names are listed for sale on this network yet."
                : "No names match these filters."}
            </p>
          ) : (
            <div className="name-grid name-grid--5">
              {visible.map((listing) => (
                <NameTile
                  key={listing.documentId}
                  listing={listing}
                  onOpen={onOpenListing}
                  onBuy={onBuy}
                  onManage={onManage}
                  canBuy={canBuy}
                  buyerIdentityId={buyerIdentityId}
                />
              ))}
            </div>
          )}
        </div>

        {visible.length > 0 && (
          <p className="browse__footnote">
            Showing {visible.length} of {listings.length} · locally indexed from
            price-update history, revalidated at purchase
          </p>
        )}
      </div>
    </div>
  );
}
