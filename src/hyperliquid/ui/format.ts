/**
 * Display formatting for prices. `formatNumber(x, 5)` (fixed 5 decimals) turns
 * BTC into "73,810.00000" and 0.005275 into "0.00528"; prices here keep about
 * six significant figures instead, with no invented decimals on big numbers.
 */

const SIG_FIGS = 6;
const MAX_DECIMALS = 10;

const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

/** "--" for anything that is not a finite positive number (NaN, Infinity, null, 0, negatives). */
export function formatPrice(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "--";
  const magnitude = Math.floor(Math.log10(price));
  const max = Math.min(MAX_DECIMALS, Math.max(0, SIG_FIGS - 1 - magnitude));
  const min = price >= 1000 ? 0 : Math.min(max, 2);
  return nf(min, max).format(price);
}
