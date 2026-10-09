/** One OHLCV bar; `time` is the bar open in unix seconds (UTC). */
export interface Bar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}
