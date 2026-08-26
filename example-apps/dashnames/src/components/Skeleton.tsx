/**
 * Loading placeholders: grids and tables load as
 * skeleton tiles/rows at the SAME dimensions — never a spinner over the grid.
 */
export function SkeletonGrid({
  count,
  columns,
}: {
  count: number;
  columns: 4 | 5 | 6;
}) {
  return (
    <div className={`name-grid name-grid--${columns}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton--tile" />
      ))}
    </div>
  );
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton--row" />
      ))}
    </div>
  );
}

export function SkeletonPortfolio({ count }: { count: number }) {
  return (
    <div className="portfolio" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton--portfolio-row" />
      ))}
    </div>
  );
}
