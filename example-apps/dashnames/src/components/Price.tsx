/**
 * Price rendering rule: DASH primary, credits
 * secondary — the DASH figure in Montserrat bold with the exact credit amount
 * directly beneath in IBM Plex Mono.
 *
 * Takes `bigint` credits, never a number: prices legitimately exceed
 * Number.MAX_SAFE_INTEGER and every conversion here is integer math.
 */
import { formatCredits, formatCreditsCompact, formatDash } from "../lib/format";

export function Price({
  credits,
  showCredits = true,
  compactCredits = false,
  align = "left",
  className,
  minDecimals = 3,
}: {
  credits: bigint;
  /** Hide the exact integer where it would compete with other prices in a grid. */
  showCredits?: boolean;
  /** Use an abbreviated credit value in dense cards; exact value remains in the title. */
  compactCredits?: boolean;
  align?: "left" | "right";
  className?: string;
  minDecimals?: number;
}) {
  const classes = ["price"];
  if (align === "right") classes.push("price--right");
  if (className) classes.push(className);

  return (
    <span className={classes.join(" ")}>
      <span className="price__dash">
        {formatDash(credits, { minDecimals })} DASH
      </span>
      {showCredits && (
        <span
          className="price__credits"
          title={
            compactCredits ? `${formatCredits(credits)} credits` : undefined
          }
        >
          {compactCredits
            ? `${formatCreditsCompact(credits)} credits`
            : `${formatCredits(credits)} credits`}
        </span>
      )}
    </span>
  );
}
