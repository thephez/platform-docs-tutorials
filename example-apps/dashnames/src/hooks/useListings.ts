/**
 * Owns the listings index: load from storage, sync against Platform, persist.
 *
 * Stale-response guarding is TWO layers, because they stop different things:
 *   - `AbortSignal` inside the sync module aborts the round trips themselves, so
 *     a superseded cold sync stops paging instead of running to completion.
 *   - a request id in the hook discards whatever a superseded run still returns.
 * Both the progress ticks, the `finally` that clears `syncing`, AND the
 * localStorage write are guarded — only the winning run may persist.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DPNS_CONTRACT_ID, type Network } from "../dash/contracts";
import {
  coldSync,
  incrementalSync,
  reconcile,
  type SyncProgress,
} from "../dash/listingsIndex";
import type { Listing, SyncState } from "../dash/listingTypes";
import * as store from "../dash/listingsStore";
import type { DashSdk } from "../dash/types";
import { errorMessage, type Logger } from "../lib/logger";

export type SyncPhase = "idle" | "syncing" | "synced" | "error";

export interface ListingsState {
  listings: Listing[];
  sync: SyncState | null;
  phase: SyncPhase;
  progress: SyncProgress | null;
  error: string | null;
  /** True when the snapshot could not be persisted; next launch cold-syncs. */
  persistFailed: boolean;
  lastSyncedAt: number | null;
}

const STALE_AFTER_MS = 4 * 60 * 1000;

export function isStale(lastSyncedAt: number | null, nowMs: number): boolean {
  if (lastSyncedAt == null) return true;
  return nowMs - lastSyncedAt > STALE_AFTER_MS;
}

export function useListings({
  sdk,
  network,
  log,
}: {
  sdk: DashSdk | null;
  network: Network;
  log?: Logger;
}) {
  const [state, setState] = useState<ListingsState>(() => {
    const snapshot = store.load(network);
    return {
      listings: snapshot?.listings ?? [],
      sync: snapshot?.sync ?? null,
      phase: "idle",
      progress: null,
      error: null,
      persistFailed: false,
      lastSyncedAt: snapshot?.sync.completedAt ?? null,
    };
  });

  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Reload from storage when the network changes — indexes are namespaced, so
  // switching must never show the other network's listings.
  useEffect(() => {
    abortRef.current?.abort();
    requestId.current += 1;
    const snapshot = store.load(network);
    setState({
      listings: snapshot?.listings ?? [],
      sync: snapshot?.sync ?? null,
      phase: "idle",
      progress: null,
      error: null,
      persistFailed: false,
      lastSyncedAt: snapshot?.sync.completedAt ?? null,
    });
  }, [network]);

  const runSync = useCallback(
    async (mode: "auto" | "cold" | "reconcile") => {
      if (!sdk) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const id = ++requestId.current;
      const isCurrent = () =>
        requestId.current === id && !controller.signal.aborted;

      setState((prev) => ({
        ...prev,
        phase: "syncing",
        progress: null,
        error: null,
      }));

      try {
        const existing = store.load(network);
        const params = {
          sdk,
          network,
          dataContractId: DPNS_CONTRACT_ID,
          signal: controller.signal,
          log,
          onProgress: (progress: SyncProgress) => {
            if (!isCurrent()) return;
            setState((prev) => ({ ...prev, progress }));
          },
        };

        let result;
        if (mode === "reconcile" && existing) {
          result = await reconcile({
            ...params,
            listings: existing.listings,
            sync: existing.sync,
          });
        } else if (mode === "auto" && existing) {
          result = await incrementalSync({
            ...params,
            listings: existing.listings,
            sync: existing.sync,
          });
        } else {
          result = await coldSync(params);
        }

        if (!isCurrent()) return;

        // Only the winning run persists. The in-memory result is kept even when
        // the write fails — but the persisted copy is dropped, so the next
        // launch cold-syncs rather than trusting watermarks whose listings
        // never landed.
        const persisted = store.save(network, {
          listings: result.listings,
          sync: result.sync,
        });

        setState({
          listings: result.listings,
          sync: result.sync,
          phase: "synced",
          progress: null,
          error: null,
          persistFailed: !persisted,
          lastSyncedAt: result.sync.completedAt,
        });
      } catch (err) {
        if (!isCurrent()) return;
        setState((prev) => ({
          ...prev,
          phase: "error",
          progress: null,
          error: errorMessage(err),
        }));
      }
    },
    [sdk, network, log],
  );

  // Sync once the SDK is available for this network.
  useEffect(() => {
    if (!sdk) return;
    void runSync("auto");
    return () => {
      abortRef.current?.abort();
    };
  }, [sdk, runSync]);

  const refresh = useCallback(() => runSync("auto"), [runSync]);
  const rebuild = useCallback(() => runSync("cold"), [runSync]);
  const repair = useCallback(() => runSync("reconcile"), [runSync]);

  /** Applies a locally-known change without waiting for the next sync. */
  const applyLocal = useCallback(
    (documentId: string, next: Listing | null) => {
      setState((prev) => {
        const listings = prev.listings.filter(
          (l) => l.documentId !== documentId,
        );
        if (next) listings.push(next);
        const sync = prev.sync;
        if (sync) store.save(network, { listings, sync });
        return { ...prev, listings };
      });
    },
    [network],
  );

  return { ...state, refresh, rebuild, repair, applyLocal };
}
