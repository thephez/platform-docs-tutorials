/**
 * Resolves `domain` document IDs to their DPNS labels.
 *
 * History records (`priceUpdate` / `purchase` / `transfer`) carry only the
 * `documentId` of the name they describe — never the label. Rendering that raw
 * ID is useless to a reader: `77XB…XG9Y` is neither a name nor an identity, and
 * under a column headed "Name" it is actively misleading.
 *
 * A module-level cache keeps repeated renders and view switches from re-querying
 * the same IDs. Batched through the same `$id IN` path as the listings index, so
 * it inherits the 100-per-request chunking and sequential fetch.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchDomainsByIds } from "../dash/dpnsQueries";
import type { DashSdk } from "../dash/types";

export interface NameLabel {
  label: string;
  parentDomainName: string;
}

/** documentId -> label, or null when the document no longer exists. */
const cache = new Map<string, NameLabel | null>();

/** Exported for tests — the cache is module state and would otherwise leak. */
export function clearLabelCache(): void {
  cache.clear();
}

export function useDocumentLabels(
  sdk: DashSdk | null,
  documentIds: readonly string[],
) {
  const [, setTick] = useState(0);

  const resolve = useCallback(
    async (ids: string[]) => {
      if (!sdk) return;
      const missing = ids.filter((id) => id && !cache.has(id));
      if (missing.length === 0) return;

      // Reserve the keys so concurrent renders don't launch duplicate queries.
      for (const id of missing) cache.set(id, null);

      try {
        const records = await fetchDomainsByIds({ sdk, documentIds: missing });
        for (const [id, record] of records) {
          cache.set(id, {
            label: record.label,
            parentDomainName: record.parentDomainName,
          });
        }
        setTick((n) => n + 1);
      } catch {
        // Leave the reserved nulls in place: the caller falls back to the
        // truncated ID rather than rendering nothing.
        setTick((n) => n + 1);
      }
    },
    [sdk],
  );

  const key = documentIds.join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await resolve(key ? key.split(",") : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, resolve]);

  return useCallback(
    (documentId: string | null | undefined): NameLabel | null =>
      documentId ? (cache.get(documentId) ?? null) : null,
    [],
  );
}
