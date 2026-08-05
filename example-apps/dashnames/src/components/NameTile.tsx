/**
 * Name tile. The Buy button appears ONLY on the hovered/focused
 * tile — deliberate, to keep the grid quiet. That reveal is CSS-driven
 * (`.name-tile:hover`), so it works on keyboard focus too.
 */
import type { Listing } from "../dash/listingTypes";
import { relativeTime } from "../lib/format";
import { DpnsName } from "./DpnsName";
import { Price } from "./Price";

export function NameTile({
  listing,
  meta,
  onOpen,
  onBuy,
  canBuy,
}: {
  listing: Listing;
  /** "4 char · 6h ago" on discover; just "3 char" on browse. */
  meta?: string;
  onOpen: (listing: Listing) => void;
  onBuy?: (listing: Listing) => void;
  canBuy?: boolean;
}) {
  const metaText =
    meta ?? `${listing.label.length} char · ${relativeTime(listing.seenAt)}`;

  return (
    <div
      className="name-tile"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(listing)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(listing);
        }
      }}
    >
      <div className="name-tile__name">
        <DpnsName
          label={listing.label}
          parentDomainName={listing.parentDomainName}
        />
      </div>
      <div className="name-tile__meta">{metaText}</div>
      <div className="name-tile__price-row">
        <Price credits={listing.price} compact className="name-tile__price" />
        {canBuy && onBuy && (
          <button
            type="button"
            className="name-tile__buy"
            onClick={(e) => {
              e.stopPropagation();
              onBuy(listing);
            }}
          >
            Buy
          </button>
        )}
      </div>
    </div>
  );
}
