/**
 * Best-effort identity -> DPNS name cache, resolved lazily for identities in
 * view. A module-level cache keeps repeated renders from re-querying.
 */
import { useCallback, useEffect, useState } from "react";
import type { DashSdk } from "../dash/types";

const cache = new Map<string, string | null>();

export function useDpnsNames(sdk: DashSdk | null, identityIds: string[]) {
  const [, setTick] = useState(0);

  const resolve = useCallback(
    async (ids: string[]) => {
      if (!sdk) return;
      let changed = false;
      for (const id of ids) {
        if (!id || cache.has(id)) continue;
        cache.set(id, null); // reserve, so concurrent renders don't re-query
        try {
          const name = await sdk.dpns.username(id);
          cache.set(id, name ?? null);
          changed = true;
        } catch {
          cache.set(id, null);
        }
      }
      if (changed) setTick((n) => n + 1);
    },
    [sdk],
  );

  const key = identityIds.join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await resolve(key ? key.split(",") : []);
    })();
    return () => {
      cancelled = true;
    };
    // `key` collapses the array identity so this doesn't loop every render.
  }, [key, resolve]);

  return useCallback((id: string | null | undefined) => {
    if (!id) return null;
    return cache.get(id) ?? null;
  }, []);
}
