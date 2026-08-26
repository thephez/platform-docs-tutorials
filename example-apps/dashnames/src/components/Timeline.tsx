/**
 * Provenance timeline: compact rows with one color-coded dot per protocol
 * event and date/block metadata right-aligned for scanning.
 *
 * Dot colors: listed/price-update `#35b0ff`, sale `#3ddb95`,
 * transfer/registration `#4a637d`.
 */
import {
  activityKind,
  isSelfTransfer,
  type HistoryEvent,
} from "../dash/listingTypes";
import { formatBlock, formatDash, relativeTime } from "../lib/format";
import { IdentityLink } from "./IdentityLink";

function dotColor(event: HistoryEvent): string {
  switch (activityKind(event)) {
    case "SALE":
      return "var(--success-green)";
    case "LISTED":
      return "var(--brand-blue-bright)";
    case "DELISTED":
      return "var(--warning-amber)";
    default:
      return "var(--timeline-dot-neutral)";
  }
}

function title(event: HistoryEvent): string {
  const kind = activityKind(event);
  if (kind === "SALE" && event.price != null) {
    return `Sold for ${formatDash(event.price)} DASH`;
  }
  if (kind === "LISTED" && event.price != null) {
    return `Listed for ${formatDash(event.price)} DASH`;
  }
  if (kind === "DELISTED") return "Listing removed";
  if (isSelfTransfer(event)) return "Transferred to self";
  return "Transferred";
}

function Detail({
  event,
  onOpenIdentity,
}: {
  event: HistoryEvent;
  onOpenIdentity: (identityId: string) => void;
}) {
  const kind = activityKind(event);
  if (kind === "SALE") {
    return (
      <>
        <IdentityLink id={event.sellerId} onOpen={onOpenIdentity} /> →{" "}
        <IdentityLink id={event.ownerId} onOpen={onOpenIdentity} /> · purchase
        record
      </>
    );
  }
  if (kind === "TRANSFER") {
    if (isSelfTransfer(event)) {
      return (
        <>
          <IdentityLink id={event.ownerId} onOpen={onOpenIdentity} /> ·{" "}
          <span
            className="self-transfer-marker"
            title="Some wallets delist by transferring a name to its current owner. This clears any active listing."
          >
            to self
          </span>{" "}
          · clears any active listing
        </>
      );
    }
    return (
      <>
        <IdentityLink id={event.ownerId} onOpen={onOpenIdentity} /> →{" "}
        <IdentityLink id={event.toIdentityId} onOpen={onOpenIdentity} /> ·
        clears any active listing
      </>
    );
  }
  return (
    <>
      Price update by{" "}
      <IdentityLink id={event.ownerId} onOpen={onOpenIdentity} />
    </>
  );
}

export function Timeline({
  events,
  onOpenIdentity,
  showRegistrationNote = true,
}: {
  events: HistoryEvent[];
  onOpenIdentity: (identityId: string) => void;
  showRegistrationNote?: boolean;
}) {
  if (events.length === 0 && !showRegistrationNote) {
    return <p className="empty-state">No recorded events for this name.</p>;
  }

  return (
    <div className="timeline">
      {events.map((event) => {
        return (
          <div key={event.id} className="timeline-entry">
            <div className="timeline-entry__rail">
              <span
                className="timeline-entry__dot"
                style={{ background: dotColor(event) }}
              />
            </div>
            <div className="timeline-entry__content">
              <div className="timeline-entry__head">
                <span className="timeline-entry__title">{title(event)}</span>
              </div>
              <div className="timeline-entry__detail">
                <Detail event={event} onOpenIdentity={onOpenIdentity} />
              </div>
            </div>
            <span className="timeline-entry__when">
              <span>{relativeTime(event.createdAt)}</span>
              {event.createdAtBlockHeight != null && (
                <span>block {formatBlock(event.createdAtBlockHeight)}</span>
              )}
            </span>
          </div>
        );
      })}

      {showRegistrationNote && (
        // Kept verbatim from the design: history genuinely starts at v13, so
        // anything earlier is simply not on chain.
        <div className="timeline-entry">
          <div className="timeline-entry__rail">
            <span
              className="timeline-entry__dot"
              style={{ background: "var(--timeline-dot-neutral)" }}
            />
          </div>
          <div className="timeline-entry__content">
            <div className="timeline-entry__head">
              <span className="timeline-entry__title">Registered</span>
            </div>
            <div className="timeline-entry__detail">
              pre-v13 history is not recorded on-chain
            </div>
          </div>
          <span className="timeline-entry__when">
            <span>before v13</span>
            <span>not on chain</span>
          </span>
        </div>
      )}
    </div>
  );
}
