import type { Time } from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import {
  atr,
  bollingerBands,
  ema,
  INDICATOR_REGISTRY,
  macd,
  rsi,
  sma,
  stochastic,
  vwap,
  type CandleData,
  type IndicatorType,
} from "../../lib/indicators.ts";

/** One chart series an indicator draws, with its data. Keys are stable per indicator. */
export type IndicatorSeriesSpec =
  | {
      key: string;
      kind: "line";
      options: { color: string; lineWidth: 1 | 2; priceScaleId: string; lineStyle?: LineStyle };
      data: { time: Time; value: number }[];
    }
  | {
      key: string;
      kind: "histogram";
      options: { priceScaleId: string };
      data: { time: Time; value: number; color: string }[];
    };

type Point = { time: number; value: number };
const pts = (xs: Point[]) => xs.map((p) => ({ time: p.time as Time, value: p.value }));

function line(
  key: string,
  data: Point[],
  color: string,
  priceScaleId: string,
  extra: { lineWidth?: 1 | 2; lineStyle?: LineStyle } = {},
): IndicatorSeriesSpec {
  return { key, kind: "line", options: { color, lineWidth: extra.lineWidth ?? 1, priceScaleId, lineStyle: extra.lineStyle }, data: pts(data) };
}

/** The series an indicator needs for the given candles. */
export function indicatorSeries(
  type: IndicatorType,
  candles: CandleData[],
  colors: { up: string; down: string },
): IndicatorSeriesSpec[] {
  const config = INDICATOR_REGISTRY.find((r) => r.type === type);
  if (!config) return [];
  const p = config.defaultParams;
  switch (type) {
    case "SMA":
      return [line("SMA", sma(candles, p.period!), config.color, "right")];
    case "EMA":
      return [line("EMA", ema(candles, p.period!), config.color, "right")];
    case "RSI": {
      const data = rsi(candles, p.period);
      const ref = (v: number) => data.map((d) => ({ time: d.time, value: v }));
      return [
        line("RSI", data, config.color, "rsi"),
        line("RSI-70", ref(70), "#555", "rsi", { lineStyle: LineStyle.Dashed }),
        line("RSI-30", ref(30), "#555", "rsi", { lineStyle: LineStyle.Dashed }),
      ];
    }
    case "MACD": {
      const d = macd(candles, p.fast, p.slow, p.signal);
      return [
        line("MACD-line", d.macd, "#2196f3", "macd"),
        line("MACD-signal", d.signal, "#ff9800", "macd"),
        {
          key: "MACD-hist",
          kind: "histogram",
          options: { priceScaleId: "macd" },
          data: d.histogram.map((h) => ({
            time: h.time as Time,
            value: h.value,
            color: h.value >= 0 ? colors.up + "99" : colors.down + "99",
          })),
        },
      ];
    }
    case "BOLL": {
      const d = bollingerBands(candles, p.period, p.stdDev);
      return [
        line("BOLL-upper", d.upper, config.color + "80", "right"),
        line("BOLL-mid", d.middle, config.color, "right"),
        line("BOLL-lower", d.lower, config.color + "80", "right"),
      ];
    }
    case "ATR":
      return [line("ATR", atr(candles, p.period), config.color, "atr")];
    case "STOCH": {
      const d = stochastic(candles, p.kPeriod, p.dPeriod);
      return [line("STOCH-K", d.k, "#ab47bc", "stoch"), line("STOCH-D", d.d, "#ff7043", "stoch")];
    }
    case "VWAP":
      return [line("VWAP", vwap(candles), config.color, "right", { lineWidth: 2, lineStyle: LineStyle.Dashed })];
    default:
      return [];
  }
}
