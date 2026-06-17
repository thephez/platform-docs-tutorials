import { useCallback, useEffect, useMemo, useState } from "react";

import type { NoteHistoryEntry } from "../dash/fetchNoteHistory";
import {
  formatRelativeTime,
  formatTimestamp,
  noteDisplayTitle,
  notePreview,
} from "../lib/format";

interface NoteHistoryPanelProps {
  open: boolean;
  entries: NoteHistoryEntry[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  canRestore: boolean;
  onClose: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onRestore: (entry: NoteHistoryEntry) => void;
}

export function NoteHistoryPanel({
  open,
  entries,
  loading,
  loadingMore,
  error,
  hasMore,
  canRestore,
  onClose,
  onRetry,
  onLoadMore,
  onRestore,
}: NoteHistoryPanelProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const latestEntry = entries[0] ?? null;
  const closePanel = useCallback(() => {
    setExpandedKey(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  const renderedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        entry,
        key: entry.blockTimeMs.toString(),
        displayTitle: noteDisplayTitle(entry),
        preview: notePreview(entry.message),
      })),
    [entries],
  );
  const activeExpandedKey = renderedEntries.some(
    ({ key }) => key === expandedKey,
  )
    ? expandedKey
    : null;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Note history"
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-black/40 md:justify-end"
      onClick={closePanel}
    >
      <aside
        className="flex h-full w-full flex-col border-line bg-surface shadow-[0_30px_70px_-22px_rgba(0,0,0,0.7)] outline-none md:max-w-[520px] md:border-l"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex min-h-[56px] items-center justify-between gap-3 border-b border-line px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-5 md:pt-3">
          <div className="min-w-0">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-4">
              History
            </h2>
            {latestEntry && (
              <p className="mt-1 truncate text-[12px] text-ink-3">
                Latest loaded revision saved{" "}
                {formatRelativeTime(latestEntry.blockTimeMs)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={closePanel}
            aria-label="Close history"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-4 transition hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-5">
          {loading ? (
            <div
              className="flex min-h-[220px] items-center justify-center"
              role="status"
              aria-label="Loading note history"
            >
              <svg
                className="h-7 w-7 animate-spin text-ink-4"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="3"
                />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[color:color-mix(in_oklab,var(--color-danger)_45%,transparent)] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))] p-4 text-[13px] leading-6 text-ink-2">
              <div className="font-semibold text-ink">History unavailable</div>
              <div className="mt-1 text-ink-3">{error}</div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-accent-dim"
              >
                Retry
              </button>
            </div>
          ) : renderedEntries.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface-2 p-4 text-[13px] leading-6 text-ink-3">
              No history entries found for this note.
            </div>
          ) : (
            <div className="space-y-3">
              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line px-4 py-2 text-[13px] font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:text-ink-4"
                >
                  {loadingMore ? "Loading…" : "Load newer revisions"}
                </button>
              )}

              {renderedEntries.map(({ entry, key, displayTitle, preview }) => {
                const expanded = activeExpandedKey === key;
                return (
                  <article
                    key={key}
                    className="overflow-hidden rounded-xl border border-line bg-bg"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedKey(expanded ? null : key)}
                      className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-surface-2"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[11px] font-semibold text-accent">
                          Revision {entry.revision}
                        </span>
                        <span
                          className="shrink-0 text-[11px] text-ink-4"
                          title={formatTimestamp(entry.blockTimeMs)}
                        >
                          {formatRelativeTime(entry.blockTimeMs)}
                        </span>
                      </span>
                      <span className="truncate text-[14px] font-semibold text-ink">
                        {displayTitle}
                      </span>
                      <span className="line-clamp-2 text-[12px] leading-5 text-ink-3">
                        {preview}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-line px-4 py-3">
                        <div className="text-[15px] font-semibold text-ink">
                          {entry.title?.trim() || "Untitled"}
                        </div>
                        <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg bg-surface px-3 py-3 text-[13px] leading-6 text-ink-2">
                          {entry.message || "Empty note"}
                        </pre>
                        {canRestore && (
                          <button
                            type="button"
                            onClick={() => onRestore(entry)}
                            className="mt-3 rounded-md border border-line px-3 py-1.5 text-[12px] font-semibold text-ink transition hover:border-accent hover:text-accent"
                          >
                            Restore this version
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
