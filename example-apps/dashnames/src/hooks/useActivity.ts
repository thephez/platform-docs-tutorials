/**
 * Merged activity feed: purchase + transfer + priceUpdate, newest first.
 *
 * Sorted client-side — `orderBy: [["$createdAt","desc"]]` is accepted but NOT
 * honoured by the SDK (verified: `desc` with `limit: 1` returns the oldest
 * record), so a server-side "newest N" is unavailable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DPNS_CONTRACT_ID } from "../dash/contracts";
import { fetchRecentEvents, sortEventsDesc } from "../dash/historyQueries";
import { STREAM_NAMES, type HistoryEvent } from "../dash/listingTypes";
import type { DashSdk } from "../dash/types";
import { errorMessage } from "../lib/logger";

export function useActivity({
  sdk,
  enabled = true,
}: {
  sdk: DashSdk | null;
  enabled?: boolean;
}) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!sdk) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      // Sequential, not Promise.all: trusted nodes throttle wide fan-out.
      const collected: HistoryEvent[] = [];
      for (const type of STREAM_NAMES) {
        const page = await fetchRecentEvents({
          sdk,
          type,
          dataContractId: DPNS_CONTRACT_ID,
        });
        if (requestId.current !== id) return;
        collected.push(...page);
      }
      setEvents(sortEventsDesc(collected));
    } catch (err) {
      if (requestId.current !== id) return;
      setError(errorMessage(err));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [sdk]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, load]);

  return { events, loading, error, refresh: load };
}
