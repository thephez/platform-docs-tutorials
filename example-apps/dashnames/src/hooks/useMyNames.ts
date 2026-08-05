/**
 * The signed-in identity's names.
 *
 * DPNS indexes `records.identity`, so the query finds names that RESOLVE to the
 * identity. Ownership is then filtered client-side on `$ownerId`, which is what
 * actually authorizes a write — a name could resolve to one identity while being
 * owned by another.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDomainsByIdentity, type DomainRecord } from "../dash/dpnsQueries";
import type { DashSdk } from "../dash/types";
import { errorMessage } from "../lib/logger";

export function useMyNames({
  sdk,
  identityId,
  enabled = true,
}: {
  sdk: DashSdk | null;
  identityId: string | null;
  enabled?: boolean;
}) {
  const [names, setNames] = useState<DomainRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!sdk || !identityId) {
      setNames([]);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const records = await fetchDomainsByIdentity({ sdk, identityId });
      if (requestId.current !== id) return;
      // Only names this identity can actually act on.
      setNames(records.filter((r) => r.ownerId === identityId));
    } catch (err) {
      if (requestId.current !== id) return;
      setError(errorMessage(err));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [sdk, identityId]);

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

  return { names, loading, error, refresh: load };
}
