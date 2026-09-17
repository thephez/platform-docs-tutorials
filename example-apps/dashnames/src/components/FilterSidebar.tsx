/**
 * Browse filter sidebar: 210px, four groups — Price (radio),
 * Length (chips), Characters (checkboxes), History (checkboxes).
 *
 * The selected radio/checkbox marker is a 14px brand-blue rounded square; the
 * unselected is an outlined square of the same size.
 */
import type {
  CharRule,
  Filters,
  HistoryRule,
  LengthFilter,
  PriceBand,
} from "../lib/filters";

const PRICE_BANDS: Array<{ value: PriceBand; label: string }> = [
  { value: "any", label: "Any" },
  { value: "under10", label: "Under 10 DASH" },
  { value: "10to100", label: "10 – 100 DASH" },
  { value: "over100", label: "100 DASH +" },
];

const LENGTHS: LengthFilter[] = [3, 4, 5, 6];

const CHAR_RULES: Array<{ value: CharRule; label: string }> = [
  { value: "lettersOnly", label: "Letters only" },
  { value: "noHyphens", label: "No hyphens" },
  { value: "noDigits", label: "No digits" },
];

const HISTORY_RULES: Array<{ value: HistoryRule; label: string }> = [
  { value: "hasSold", label: "Has sold before" },
  { value: "priceDropped", label: "Price dropped" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function FilterSidebar({
  filters,
  onChange,
  historyRulesEnabled,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** History rules need per-listing history facts; disabled until available. */
  historyRulesEnabled: boolean;
}) {
  return (
    <aside className="filter-sidebar">
      <div className="filter-group">
        <div className="label-caps filter-group__label">Price</div>
        <div className="filter-options">
          {PRICE_BANDS.map((band) => (
            <button
              key={band.value}
              type="button"
              className="filter-option"
              aria-pressed={filters.priceBand === band.value}
              onClick={() => onChange({ ...filters, priceBand: band.value })}
            >
              <span
                className={`filter-marker${filters.priceBand === band.value ? " filter-marker--on" : ""}`}
              />
              {band.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="label-caps filter-group__label">Length</div>
        <div className="filter-chips">
          {LENGTHS.map((len) => (
            <button
              key={len}
              type="button"
              className={`filter-chip${filters.lengths.includes(len) ? " filter-chip--active" : ""}`}
              aria-pressed={filters.lengths.includes(len)}
              onClick={() =>
                onChange({ ...filters, lengths: toggle(filters.lengths, len) })
              }
            >
              {len === 6 ? "6+" : len}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="label-caps filter-group__label">Characters</div>
        <div className="filter-options">
          {CHAR_RULES.map((rule) => (
            <button
              key={rule.value}
              type="button"
              className="filter-option"
              aria-pressed={filters.charRules.includes(rule.value)}
              onClick={() =>
                onChange({
                  ...filters,
                  charRules: toggle(filters.charRules, rule.value),
                })
              }
            >
              <span
                className={`filter-marker${filters.charRules.includes(rule.value) ? " filter-marker--on" : ""}`}
              />
              {rule.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <div className="label-caps filter-group__label">History</div>
        <div className="filter-options">
          {HISTORY_RULES.map((rule) => (
            <button
              key={rule.value}
              type="button"
              className="filter-option"
              disabled={!historyRulesEnabled}
              aria-pressed={filters.historyRules.includes(rule.value)}
              title={
                historyRulesEnabled
                  ? undefined
                  : "Available once sale history has loaded"
              }
              style={historyRulesEnabled ? undefined : { opacity: 0.45 }}
              onClick={() =>
                onChange({
                  ...filters,
                  historyRules: toggle(filters.historyRules, rule.value),
                })
              }
            >
              <span
                className={`filter-marker${filters.historyRules.includes(rule.value) ? " filter-marker--on" : ""}`}
              />
              {rule.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
