/**
 * Name detail: the current document plus its merged event timeline.
 *
 * The document is always re-fetched from Platform rather than read out of the
 * local index — the index is for discovery, a fresh fetch is for anything the
 * user acts on.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DPNS_CONTRACT_ID } from "../dash/contracts";
import { fetchDomainById, type DomainRecord } from "../dash/dpnsQueries";
import { fetchDocumentHistory, sortEventsDesc } from "../dash/historyQueries";
import { STREAM_NAMES, type HistoryEvent } from "../dash/listingTypes";
import type { DashSdk } from "../dash/types";
import { errorMessage } from "../lib/logger";

export interface NameDetail {
  record: DomainRecord | null;
  /** purchase + transfer, newest first — the ownership timeline. */
  ownership: HistoryEvent[];
  /** priceUpdate, newest first — the asking-price history tab. */
  priceHistory: HistoryEvent[];
}

export function useNameDetail({
  sdk,
  documentId,
}: {
  sdk: DashSdk | null;
  documentId: string | null;
}) {
  const [detail, setDetail] = useState<NameDetail>({
    record: null,
    ownership: [],
    priceHistory: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!sdk || !documentId) {
      setDetail({ record: null, ownership: [], priceHistory: [] });
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const record = await fetchDomainById({ sdk, documentId });
      if (requestId.current !== id) return;

      // The record is shown even when the timeline can't be loaded: history is a
      // separate contract that may not exist on this network, and a name that
      // resolves must never render as "not found".
      setDetail({ record, ownership: [], priceHistory: [] });

      const byType = new Map<string, HistoryEvent[]>();
      try {
        for (const type of STREAM_NAMES) {
          const events = await fetchDocumentHistory({
            sdk,
            type,
            dataContractId: DPNS_CONTRACT_ID,
            documentId,
          });
          if (requestId.current !== id) return;
          byType.set(type, events);
        }
      } catch (err) {
        if (requestId.current !== id) return;
        setError(errorMessage(err));
        return;
      }

      setDetail({
        record,
        ownership: sortEventsDesc([
          ...(byType.get("purchase") ?? []),
          ...(byType.get("transfer") ?? []),
        ]),
        priceHistory: sortEventsDesc(byType.get("priceUpdate") ?? []),
      });
    } catch (err) {
      if (requestId.current !== id) return;
      setError(errorMessage(err));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [sdk, documentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { ...detail, loading, error, refresh: load };
}
