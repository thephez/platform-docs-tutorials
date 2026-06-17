/**
 * Document-history queries for Dashnote notes.
 *
 * SDK method:
 *   sdk.documents.history({ dataContractId, documentTypeName, documentId, startAtMs, limit })
 */
import type { Logger } from "../lib/logger";
import type {
  DashDocumentLike,
  DashNoteQueryDocument,
  DashNoteQueryJson,
  DashSdk,
} from "./types";

export const NOTE_HISTORY_PAGE_LIMIT = 10;

export interface NoteHistoryEntry {
  blockTimeMs: number;
  revision: number;
  title: string | null;
  message: string;
  updatedAt: number | null;
}

export interface FetchNoteHistoryResult {
  entries: NoteHistoryEntry[];
  nextStartAtMs: number | null;
}

function toTimestamp(
  value: DashNoteQueryJson["$createdAt"] | DashNoteQueryJson["$updatedAt"],
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toRevision(
  value: number | string | bigint | undefined,
  fallback?: number | string | bigint,
): number {
  const raw = value ?? fallback;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  if (typeof raw === "string" && raw) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBlockTimeMs(value: bigint): number {
  return Number(value);
}

function toHistoryEntry(
  blockTimeKey: bigint,
  raw: DashDocumentLike,
): NoteHistoryEntry {
  const document = raw as DashNoteQueryDocument;
  const json: DashNoteQueryJson =
    typeof document?.toJSON === "function" ? document.toJSON() : document;

  return {
    blockTimeMs: toBlockTimeMs(blockTimeKey),
    revision: toRevision(json.$revision, document.revision),
    title: typeof json.title === "string" ? json.title : null,
    message: typeof json.message === "string" ? json.message : "",
    updatedAt: toTimestamp(json.$updatedAt),
  };
}

export async function fetchNoteHistory({
  sdk,
  contractId,
  noteId,
  startAtMs = 0,
  limit = NOTE_HISTORY_PAGE_LIMIT,
  log,
}: {
  sdk: DashSdk;
  contractId: string;
  noteId: string;
  startAtMs?: number;
  limit?: number;
  log?: Logger;
}): Promise<FetchNoteHistoryResult> {
  const pageLimit = Math.min(Math.max(1, limit), NOTE_HISTORY_PAGE_LIMIT);
  log?.(
    startAtMs > 0
      ? `Loading newer note history after ${startAtMs}…`
      : `Loading note history for ${noteId}…`,
  );

  const history = await sdk.documents.history({
    dataContractId: contractId,
    documentTypeName: "note",
    documentId: noteId,
    startAtMs,
    limit: pageLimit,
  });

  // Document history is keyed by block timestamp and paged in ascending order.
  // The UI renders each loaded page newest-first, then uses the newest
  // timestamp as the next exclusive start cursor.
  const chronological = Array.from(history.entries())
    .map(([blockTimeKey, document]) => toHistoryEntry(blockTimeKey, document))
    .sort((left, right) => left.blockTimeMs - right.blockTimeMs);

  const newest = chronological.at(-1);
  return {
    entries: [...chronological].reverse(),
    nextStartAtMs: newest ? newest.blockTimeMs : null,
  };
}
