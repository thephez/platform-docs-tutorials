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
  compact = false,
  align = "left",
  className,
  minDecimals = 3,
}: {
  credits: bigint;
  /** Compact credits ("31.0T credits") for tight spots like tiles. */
  compact?: boolean;
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
      <span className="price__credits">
        {compact ? formatCreditsCompact(credits) : formatCredits(credits)}{" "}
        credits
      </span>
    </span>
  );
}
