export function AppNotices({
  error,
  hasContract,
}: {
  error: string | null;
  hasContract: boolean;
}) {
  return (
    <>
      {error && <div className="notice error">{error}</div>}
      {!hasContract && (
        <div className="notice info">
          No Sift contract configured yet. Register one or paste a contract ID
          in the Account tab.
        </div>
      )}
    </>
  );
}
