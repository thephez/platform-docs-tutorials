/**
 * Sync chip: three states — synced (green dot, block
 * number), syncing (pulsing amber dot), stale (red dot + manual refresh).
 *
 * "Indexing is visible" is a product constraint: every browse view carries this
 * chip, because the listing set is built locally rather than served by an index.
 */
import { formatBlock, relativeTime } from "../lib/format";
import type { SyncPhase } from "../hooks/useListings";
import type { SyncProgress } from "../dash/listingsIndex";

export function SyncChip({
  phase,
  progress,
  lastSyncedAt,
  stale,
  blockHeight,
  showBlock = false,
  onRefresh,
}: {
  phase: SyncPhase;
  progress?: SyncProgress | null;
  lastSyncedAt: number | null;
  stale: boolean;
  blockHeight?: bigint | null;
  /** The stat-strip chip shows the block; the toolbar chip shows elapsed time. */
  showBlock?: boolean;
  onRefresh?: () => void;
}) {
  if (phase === "syncing") {
    const detail =
      progress?.phase === "documents" && progress.documentsTotal
        ? `NAMES ${progress.documentsFetched}/${progress.documentsTotal}`
        : progress?.phase === "history"
          ? `HISTORY PAGE ${progress.historyPagesFetched}`
          : "";
    return (
      <span className="sync-chip sync-chip--syncing">
        <span className="sync-chip__dot" />
        SYNCING…{detail ? ` · ${detail}` : ""}
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="sync-chip sync-chip--stale">
        <span className="sync-chip__dot" />
        SYNC FAILED
        {onRefresh && (
          <button
            type="button"
            className="sync-chip__refresh"
            onClick={onRefresh}
          >
            RETRY
          </button>
        )}
      </span>
    );
  }

  if (stale || lastSyncedAt == null) {
    return (
      <span className="sync-chip sync-chip--stale">
        <span className="sync-chip__dot" />
        {lastSyncedAt == null
          ? "NOT SYNCED"
          : `LAST SYNCED ${relativeTime(lastSyncedAt).toUpperCase()}`}
        {onRefresh && (
          <button
            type="button"
            className="sync-chip__refresh"
            onClick={onRefresh}
          >
            REFRESH
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="sync-chip">
      <span className="sync-chip__dot" />
      {showBlock && blockHeight != null
        ? `SYNCED · BLOCK ${formatBlock(blockHeight)}`
        : `SYNCED ${relativeTime(lastSyncedAt).toUpperCase()}`}
    </span>
  );
}
