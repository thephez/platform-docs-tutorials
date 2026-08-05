/**
 * Discover / homepage: hero + search, stat strip, recently listed,
 * recent sales.
 *
 * Deviations from the design, both deliberate:
 *  - No "Shelves" row. Curated collections need data the protocol doesn't
 *    provide (there is no notion of a curated set), so a fabricated one would
 *    be sample data shipped as if real.
 *  - The hero search never routes to a register flow. This app trades existing
 *    names; an unregistered name reports "not registered" and stops.
 */
import type { FormEvent } from "react";
import type { Listing } from "../dash/listingTypes";
import type { HistoryEvent } from "../dash/listingTypes";
import type { SalesStats } from "../dash/historyAggregates";
import type { SyncPhase } from "../hooks/useListings";
import type { SyncProgress } from "../dash/listingsIndex";
import type { SearchOutcome } from "../hooks/useNameSearch";
import type { NameLabel } from "../hooks/useDocumentLabels";
import { formatDash, relativeTime, shortId } from "../lib/format";
import { NameCell } from "./NameCell";
import { NameTile } from "./NameTile";
import { Price } from "./Price";
import { SkeletonGrid, SkeletonRows } from "./Skeleton";
import { SyncChip } from "./SyncChip";

export function DiscoverView({
  listings,
  sales,
  salesStats,
  syncPhase,
  syncProgress,
  lastSyncedAt,
  stale,
  searchInput,
  onSearchInput,
  onSearchSubmit,
  searchOutcome,
  onOpenListing,
  onOpenDocument,
  onBuy,
  onManage,
  onSeeAll,
  canBuy,
  buyerIdentityId,
  loadingSales,
  onRefresh,
  lookupName,
}: {
  listings: Listing[];
  sales: HistoryEvent[];
  salesStats: SalesStats;
  syncPhase: SyncPhase;
  syncProgress: SyncProgress | null;
  lastSyncedAt: number | null;
  stale: boolean;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onSearchSubmit: () => void;
  searchOutcome: SearchOutcome;
  onOpenListing: (listing: Listing) => void;
  onOpenDocument: (documentId: string) => void;
  onBuy: (listing: Listing) => void;
  onManage: (listing: Listing) => void;
  onSeeAll: () => void;
  canBuy: boolean;
  buyerIdentityId: string | null;
  loadingSales: boolean;
  onRefresh: () => void;
  /** Resolves a sale record's documentId to its DPNS label. */
  lookupName: (documentId: string) => NameLabel | null;
}) {
  // Newest first — `seenAt` is when the index last confirmed the listing.
  const recent = [...listings].sort((a, b) => b.seenAt - a.seenAt).slice(0, 6);
  // Cheapest short names stand in for "popular": real listings, no invented data.
  const popular = [...listings]
    .filter((l) => l.normalizedLabel.length <= 5)
    .sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0))
    .slice(0, 2);
  const syncing = syncPhase === "syncing";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSearchSubmit();
  }

  return (
    <>
      <section className="hero">
        <div className="hero__glow-a" aria-hidden="true" />
        <div className="hero__glow-b" aria-hidden="true" />
        <div className="hero__inner">
          <h1 className="hero__headline">
            Your name, on Dash.
            <br />
            Owned, transferable, and now for sale.
          </h1>
          <p className="hero__sub">
            A DPNS name resolves payments and identity the way DNS resolves a
            website. Find one that is for sale, or look up who holds it.
          </p>

          <form className="hero-search" onSubmit={handleSubmit}>
            <div className="hero-search__field">
              <input
                className="hero-search__input"
                value={searchInput}
                onChange={(e) => onSearchInput(e.target.value)}
                placeholder="Search a name"
                aria-label="Search a name"
                spellCheck={false}
                autoCapitalize="none"
              />
              <SearchBadge outcome={searchOutcome} />
            </div>
            <button
              type="submit"
              className="hero-search__button"
              disabled={!searchInput.trim()}
            >
              Search
            </button>
          </form>

          {/* Popular chips are derived from the live index — the design's
              `pay.dash` / `bank.dash` samples are fabricated data. With nothing
              listed there is nothing popular to show, so the row is omitted
              rather than filled with invented names. */}
          {popular.length > 0 && (
            <div className="hero-popular">
              <span className="hero-popular__label">Popular:</span>
              {popular.map((listing) => (
                <button
                  key={listing.documentId}
                  type="button"
                  className="pill"
                  onClick={() => onOpenListing(listing)}
                >
                  {listing.label}.{listing.parentDomainName}
                </button>
              ))}
              <button type="button" className="pill" onClick={onSeeAll}>
                3-letter names
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="market-stats" aria-label="Market statistics">
        <div className="market-stat">
          <span className="label-caps">Names for sale</span>
          <span className="market-stat__value">
            {syncing && listings.length === 0
              ? "—"
              : listings.length.toLocaleString("en-US")}
          </span>
        </div>
        <div className="market-stat">
          <span className="label-caps">Sold in 30 days</span>
          {salesStats.count == null ? (
            <span className="market-stat__empty">
              {salesStats.unavailable
                ? "Not available on this network"
                : "No sales recorded yet"}
            </span>
          ) : (
            <span className="market-stat__value">
              {salesStats.count.toLocaleString("en-US")}
            </span>
          )}
        </div>
        <div className="market-stat">
          <span className="label-caps">30d volume</span>
          {salesStats.volumeCredits == null ? (
            <span className="market-stat__empty">
              {salesStats.unavailable
                ? "Not available on this network"
                : "No sales recorded yet"}
            </span>
          ) : (
            <span className="market-stat__value">
              {formatDash(salesStats.volumeCredits, {
                minDecimals: 0,
                maxDecimals: 3,
              })}{" "}
              <span className="market-stat__unit">DASH</span>
            </span>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Recently listed</h2>
          <div className="section__actions">
            <SyncChip
              phase={syncPhase}
              progress={syncProgress}
              lastSyncedAt={lastSyncedAt}
              stale={stale}
              onRefresh={onRefresh}
            />
            {listings.length > 0 && (
              <button
                type="button"
                className="section__link"
                onClick={onSeeAll}
              >
                See all {listings.length.toLocaleString("en-US")} →
              </button>
            )}
          </div>
        </div>

        {syncing && listings.length === 0 ? (
          <SkeletonGrid count={6} columns={6} />
        ) : recent.length === 0 ? (
          <div className="data-table">
            <p className="empty-state">
              No names are listed for sale on this network yet. Listings appear
              here as soon as an owner sets a price.
            </p>
          </div>
        ) : (
          <div className="name-grid name-grid--6">
            {recent.map((listing) => (
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
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">Recent sales</h2>
          <span className="section__note">From protocol purchase records</span>
        </div>
        <div className="data-table">
          <div
            className="data-table__row data-table__row--head"
            style={{ gridTemplateColumns: "1.4fr 1fr 1fr .8fr" }}
          >
            <span className="label-caps">Name</span>
            <span className="label-caps align-right">Sale price</span>
            <span className="label-caps">Buyer</span>
            <span className="label-caps align-right">When</span>
          </div>

          {loadingSales ? (
            <SkeletonRows count={3} />
          ) : sales.length === 0 ? (
            <p className="empty-state">
              No sales recorded yet. Purchase history starts at protocol v13.
            </p>
          ) : (
            sales.slice(0, 5).map((sale) => (
              <div
                key={sale.id}
                className="data-table__row"
                style={{ gridTemplateColumns: "1.4fr 1fr 1fr .8fr" }}
              >
                <NameCell
                  documentId={sale.documentId}
                  name={lookupName(sale.documentId)}
                  onClick={() => onOpenDocument(sale.documentId)}
                />
                <span className="align-right">
                  {sale.price != null ? (
                    <Price credits={sale.price} align="right" />
                  ) : (
                    <span className="amount-dash">—</span>
                  )}
                </span>
                <span className="data-table__cell-mono">
                  {shortId(sale.ownerId)}
                </span>
                <span className="data-table__cell-meta align-right">
                  {relativeTime(sale.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function SearchBadge({ outcome }: { outcome: SearchOutcome }) {
  if (outcome.kind === "searching") {
    return (
      <span className="hero-search__badge hero-search__badge--taken">
        CHECKING…
      </span>
    );
  }
  if (outcome.kind === "unregistered") {
    return (
      <span className="hero-search__badge hero-search__badge--unregistered">
        NOT REGISTERED
      </span>
    );
  }
  if (outcome.kind === "found") {
    const { record } = outcome;
    if (record.price != null && record.price > 0n) {
      return (
        <span className="hero-search__badge hero-search__badge--for-sale">
          FOR SALE ·{" "}
          {formatDash(record.price, { minDecimals: 0, maxDecimals: 3 })} DASH
        </span>
      );
    }
    return (
      <span className="hero-search__badge hero-search__badge--taken">
        TAKEN
      </span>
    );
  }
  return null;
}
