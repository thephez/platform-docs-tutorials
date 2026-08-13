/**
 * The signed-in identity's names.
 *
 * DPNS indexes `records.identity`, so the query finds names that RESOLVE to the
 * identity. Ownership is then filtered client-side on `$ownerId`, which is what
 * actually authorizes a write — a name could resolve to one identity while being
 * owned by another.
 */
import { useMemo } from "react";
import type { DashSdk } from "../dash/types";
import { useIdentityNames } from "./useIdentityNames";

export function useMyNames({
  sdk,
  identityId,
  enabled = true,
}: {
  sdk: DashSdk | null;
  identityId: string | null;
  enabled?: boolean;
}) {
  const result = useIdentityNames({ sdk, identityId, enabled });
  const names = useMemo(
    () => result.names.filter((record) => record.ownerId === identityId),
    [result.names, identityId],
  );
  return { ...result, names };
}
