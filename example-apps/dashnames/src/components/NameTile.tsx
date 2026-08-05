/**
 * Name tile. Prices stay deliberately compact (DASH only), and the Buy action
 * remains visible so scanning the grid never hides the marketplace's primary
 * action or causes content to reflow on hover.
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
  onManage,
  canBuy,
  buyerIdentityId,
}: {
  listing: Listing;
  /** "4 char · 6h ago" on discover; just "3 char" on browse. */
  meta?: string;
  onOpen: (listing: Listing) => void;
  onBuy?: (listing: Listing) => void;
  onManage?: (listing: Listing) => void;
  canBuy?: boolean;
  /** Suppresses self-purchase; owners manage their listing from My names. */
  buyerIdentityId?: string | null;
}) {
  const metaText =
    meta ?? `${listing.label.length} char · ${relativeTime(listing.seenAt)}`;
  const isOwner = Boolean(
    buyerIdentityId && listing.ownerId === buyerIdentityId,
  );
  const action = isOwner ? onManage : canBuy ? onBuy : undefined;

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
        <Price
          credits={listing.price}
          showCredits={false}
          minDecimals={0}
          className="name-tile__price"
        />
        {action && (
          <button
            type="button"
            className="name-tile__action"
            onClick={(e) => {
              e.stopPropagation();
              action(listing);
            }}
          >
            {isOwner ? "Manage" : "Buy"}
          </button>
        )}
      </div>
    </div>
  );
}
