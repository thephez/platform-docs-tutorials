/**
 * Provable sales aggregates for the stat strip.
 *
 * A null count/volume means "no sales recorded yet" — the caught empty-set proof
 * error — and renders as the empty state, never as a zero. See
 * dash/historyAggregates.ts for why an empty aggregate is an error path.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DPNS_CONTRACT_ID } from "../dash/contracts";
import {
  fetchSalesStats,
  last30Days,
  type SalesStats,
} from "../dash/historyAggregates";
import type { DashSdk } from "../dash/types";
import { errorMessage } from "../lib/logger";

export function useSalesStats({
  sdk,
  enabled = true,
}: {
  sdk: DashSdk | null;
  enabled?: boolean;
}) {
  const [stats, setStats] = useState<SalesStats>({
    count: null,
    volumeCredits: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!sdk) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSalesStats({
        sdk,
        dataContractId: DPNS_CONTRACT_ID,
        window: last30Days(Date.now()),
      });
      if (requestId.current !== id) return;
      setStats(result);
    } catch (err) {
      // Only genuine query failures land here — the empty-set case is already
      // mapped to nulls inside fetchSalesStats.
      if (requestId.current !== id) return;
      setError(errorMessage(err));
      setStats({ count: null, volumeCredits: null });
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

  return { stats, loading, error, refresh: load };
}
