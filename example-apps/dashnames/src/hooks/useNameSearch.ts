/**
 * Hero/header search over DPNS labels.
 *
 * Uses a server-side prefix query rather than the local index, so search keeps
 * working on a network where nothing is listed (mainnet today).
 *
 * An unregistered name resolves to "not registered" and stops there — this app
 * trades existing names and deliberately has no registration flow.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchDomainByLabel,
  normalizeLabelInput,
  searchDomainsByPrefix,
  toNormalizedLabel,
  type DomainRecord,
} from "../dash/dpnsQueries";
import type { DashSdk } from "../dash/types";
import { errorMessage } from "../lib/logger";

export type SearchOutcome =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "found"; record: DomainRecord }
  | { kind: "unregistered"; label: string }
  | { kind: "error"; message: string };

export function useNameSearch(sdk: DashSdk | null) {
  const [outcome, setOutcome] = useState<SearchOutcome>({ kind: "idle" });
  const [suggestions, setSuggestions] = useState<DomainRecord[]>([]);
  const requestId = useRef(0);

  const search = useCallback(
    async (input: string): Promise<SearchOutcome> => {
      const label = normalizeLabelInput(input);
      if (!sdk || !label) {
        setOutcome({ kind: "idle" });
        return { kind: "idle" };
      }

      const id = ++requestId.current;
      setOutcome({ kind: "searching" });
      try {
        const record = await fetchDomainByLabel({
          sdk,
          // DPNS stores the homograph-folded label, so `latte` must be looked up
          // as `1atte`. The user still sees what they typed.
          normalizedLabel: await toNormalizedLabel(sdk, label),
        });
        if (requestId.current !== id) return { kind: "idle" };
        const next: SearchOutcome = record
          ? { kind: "found", record }
          : { kind: "unregistered", label };
        setOutcome(next);
        return next;
      } catch (err) {
        if (requestId.current !== id) return { kind: "idle" };
        const next: SearchOutcome = {
          kind: "error",
          message: errorMessage(err),
        };
        setOutcome(next);
        return next;
      }
    },
    [sdk],
  );

  const suggest = useCallback(
    async (input: string) => {
      const prefix = normalizeLabelInput(input);
      if (!sdk || prefix.length < 2) {
        setSuggestions([]);
        return;
      }
      const id = ++requestId.current;
      try {
        const records = await searchDomainsByPrefix({
          sdk,
          prefix: await toNormalizedLabel(sdk, prefix),
          limit: 8,
        });
        if (requestId.current !== id) return;
        setSuggestions(records);
      } catch {
        if (requestId.current === id) setSuggestions([]);
      }
    },
    [sdk],
  );

  const reset = useCallback(() => {
    requestId.current += 1;
    setOutcome({ kind: "idle" });
    setSuggestions([]);
  }, []);

  return { outcome, suggestions, search, suggest, reset };
}

/** Debounces prefix suggestions so typing doesn't fire a query per keystroke. */
export function useDebouncedSuggest(
  suggest: (input: string) => void,
  input: string,
  delayMs = 220,
) {
  useEffect(() => {
    const handle = window.setTimeout(() => suggest(input), delayMs);
    return () => window.clearTimeout(handle);
  }, [suggest, input, delayMs]);
}
