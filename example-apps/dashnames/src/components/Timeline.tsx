/**
 * Provenance timeline: rail of dots + connectors, one entry per
 * protocol event.
 *
 * Dot colors: listed/price-update `#35b0ff`, sale `#3ddb95`,
 * transfer/registration `#4a637d`.
 */
import { activityKind, type HistoryEvent } from "../dash/listingTypes";
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
    return (
      <>
        <IdentityLink id={event.ownerId} onOpen={onOpenIdentity} /> →{" "}
        <IdentityLink id={event.toIdentityId} onOpen={onOpenIdentity} />·
        listing cleared by transfer
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
      {events.map((event, index) => {
        const isLast = index === events.length - 1 && !showRegistrationNote;
        return (
          <div key={event.id} className="timeline-entry">
            <div className="timeline-entry__rail">
              <span
                className="timeline-entry__dot"
                style={{ background: dotColor(event) }}
              />
              {!isLast && <span className="timeline-entry__connector" />}
            </div>
            <div>
              <div className="timeline-entry__head">
                <span className="timeline-entry__title">{title(event)}</span>
                <span className="timeline-entry__when">
                  {relativeTime(event.createdAt)}
                  {event.createdAtBlockHeight != null &&
                    ` · block ${formatBlock(event.createdAtBlockHeight)}`}
                </span>
              </div>
              <div className="timeline-entry__detail">
                <Detail event={event} onOpenIdentity={onOpenIdentity} />
              </div>
            </div>
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
          <div>
            <div className="timeline-entry__head">
              <span className="timeline-entry__title">Registered</span>
            </div>
            <div className="timeline-entry__detail">
              pre-v13 history is not recorded on-chain
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
