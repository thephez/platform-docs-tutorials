import { useCallback, useEffect, useRef, useState } from "react";
import { fetchDomainsByIdentity, type DomainRecord } from "../dash/dpnsQueries";
import type { DashSdk } from "../dash/types";
import { errorMessage } from "../lib/logger";

/** All DPNS names whose identity record resolves to a given identity. */
export function useIdentityNames({
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
    const id = ++requestId.current;
    if (!sdk || !identityId) {
      setNames([]);
      setError(null);
      setLoading(false);
      return;
    }

    setNames([]);
    setLoading(true);
    setError(null);
    try {
      const records = await fetchDomainsByIdentity({ sdk, identityId });
      if (requestId.current === id) setNames(records);
    } catch (err) {
      if (requestId.current === id) setError(errorMessage(err));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [sdk, identityId]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      requestId.current += 1;
    };
  }, [enabled, load]);

  return { names, loading, error, refresh: load };
}
