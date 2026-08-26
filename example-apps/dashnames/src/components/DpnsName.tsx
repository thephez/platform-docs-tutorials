/**
 * Name rendering rule: a DPNS name ALWAYS renders as
 * the label in `text/primary` followed by the `.dash` suffix in `text/muted`.
 * Applies in tiles, tables, headings, portfolio rows — everywhere.
 */
export function DpnsName({
  label,
  parentDomainName = "dash",
  className,
}: {
  label: string;
  parentDomainName?: string;
  className?: string;
}) {
  return (
    <span className={className ? `dpns-name ${className}` : "dpns-name"}>
      {label}
      <span className="dpns-name__suffix">.{parentDomainName}</span>
    </span>
  );
}
