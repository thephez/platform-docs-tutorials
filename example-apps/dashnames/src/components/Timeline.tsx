/**
 * Provenance timeline: rail of dots + connectors, one entry per
 * protocol event.
 *
 * Dot colors: listed/price-update `#35b0ff`, sale `#3ddb95`,
 * transfer/registration `#4a637d`.
 */
import { activityKind, type HistoryEvent } from "../dash/listingTypes";
import type { Network } from "../dash/contracts";
import { formatBlock, formatDash, relativeTime } from "../lib/format";
import { ExplorerId } from "./ExplorerId";

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

function Detail({ event, network }: { event: HistoryEvent; network: Network }) {
  const kind = activityKind(event);
  if (kind === "SALE") {
    return (
      <>
        <ExplorerId network={network} kind="identity" id={event.sellerId} /> →{" "}
        <ExplorerId network={network} kind="identity" id={event.ownerId} /> ·
        purchase record
      </>
    );
  }
  if (kind === "TRANSFER") {
    return (
      <>
        <ExplorerId network={network} kind="identity" id={event.ownerId} /> →{" "}
        <ExplorerId network={network} kind="identity" id={event.toIdentityId} />
        · listing cleared by transfer
      </>
    );
  }
  return (
    <>
      Price update by{" "}
      <ExplorerId network={network} kind="identity" id={event.ownerId} />
    </>
  );
}

export function Timeline({
  events,
  network,
  showRegistrationNote = true,
}: {
  events: HistoryEvent[];
  network: Network;
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
                <Detail event={event} network={network} />
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
