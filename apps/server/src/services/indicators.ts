import type { OHLCV, IndicatorType } from '@opencharts/common';
import {
  SMA, EMA, WMA, DEMA, TEMA,
  RSI, MACD, BollingerBands,
  Stochastic, ATR, ADX, CCI, MFI,
  OBV, WilliamsR, IchimokuCloud, PSAR,
  ROC, StochasticRSI,
} from 'technicalindicators';

type IndicatorComputer = (
  bars: OHLCV[],
  params: Record<string, number>,
) => Record<string, (number | null)[]>;

function padLeft(values: number[], totalLength: number): (number | null)[] {
  const padding = totalLength - values.length;
  return [...Array(Math.max(0, padding)).fill(null), ...values];
}

const computers: Record<IndicatorType, IndicatorComputer> = {
  SMA: (bars, params) => {
    const period = params.period ?? 20;
    const result = SMA.calculate({ period, values: bars.map((b) => b.close) });
    return { sma: padLeft(result, bars.length) };
  },

  EMA: (bars, params) => {
    const period = params.period ?? 20;
    const result = EMA.calculate({ period, values: bars.map((b) => b.close) });
    return { ema: padLeft(result, bars.length) };
  },

  WMA: (bars, params) => {
    const period = params.period ?? 20;
    const result = WMA.calculate({ period, values: bars.map((b) => b.close) });
    return { wma: padLeft(result, bars.length) };
  },

  DEMA: (bars, params) => {
    const period = params.period ?? 20;
    const result = DEMA.calculate({ period, values: bars.map((b) => b.close) });
    return { dema: padLeft(result, bars.length) };
  },

  TEMA: (bars, params) => {
    const period = params.period ?? 20;
    const result = TEMA.calculate({ period, values: bars.map((b) => b.close) });
    return { tema: padLeft(result, bars.length) };
  },

  VWAP: (bars) => {
    // technicalindicators doesn't include VWAP — keep our implementation
    const result: (number | null)[] = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;
    for (const bar of bars) {
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      cumulativeTPV += typicalPrice * bar.volume;
      cumulativeVolume += bar.volume;
      result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null);
    }
    return { vwap: result };
  },

  RSI: (bars, params) => {
    const period = params.period ?? 14;
    const result = RSI.calculate({ period, values: bars.map((b) => b.close) });
    return { rsi: padLeft(result, bars.length) };
  },

  MACD: (bars, params) => {
    const result = MACD.calculate({
      fastPeriod: params.fast ?? 12,
      slowPeriod: params.slow ?? 26,
      signalPeriod: params.signal ?? 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
      values: bars.map((b) => b.close),
    });
    const macdLine = padLeft(result.map((r) => r.MACD ?? 0), bars.length);
    const signalLine = padLeft(result.map((r) => r.signal ?? 0), bars.length);
    const histogram = padLeft(result.map((r) => r.histogram ?? 0), bars.length);
    return { macd: macdLine, signal: signalLine, histogram };
  },

  BBANDS: (bars, params) => {
    const period = params.period ?? 20;
    const stdDev = params.stddev ?? 2;
    const result = BollingerBands.calculate({
      period,
      stdDev,
      values: bars.map((b) => b.close),
    });
    return {
      upper: padLeft(result.map((r) => r.upper), bars.length),
      middle: padLeft(result.map((r) => r.middle), bars.length),
      lower: padLeft(result.map((r) => r.lower), bars.length),
    };
  },

  STOCH: (bars, params) => {
    const period = params.period ?? 14;
    const signalPeriod = params.signalPeriod ?? 3;
    const result = Stochastic.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      period,
      signalPeriod,
    });
    return {
      k: padLeft(result.map((r) => r.k), bars.length),
      d: padLeft(result.map((r) => r.d), bars.length),
    };
  },

  ATR: (bars, params) => {
    const period = params.period ?? 14;
    const result = ATR.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      period,
    });
    return { atr: padLeft(result, bars.length) };
  },

  ADX: (bars, params) => {
    const period = params.period ?? 14;
    const result = ADX.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      period,
    });
    return {
      adx: padLeft(result.map((r) => r.adx), bars.length),
      pdi: padLeft(result.map((r) => r.pdi), bars.length),
      mdi: padLeft(result.map((r) => r.mdi), bars.length),
    };
  },

  CCI: (bars, params) => {
    const period = params.period ?? 20;
    const result = CCI.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      period,
    });
    return { cci: padLeft(result, bars.length) };
  },

  MFI: (bars, params) => {
    const period = params.period ?? 14;
    const result = MFI.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      volume: bars.map((b) => b.volume),
      period,
    });
    return { mfi: padLeft(result, bars.length) };
  },

  OBV: (bars) => {
    const result = OBV.calculate({
      close: bars.map((b) => b.close),
      volume: bars.map((b) => b.volume),
    });
    return { obv: padLeft(result, bars.length) };
  },

  WILLIAMS_R: (bars, params) => {
    const period = params.period ?? 14;
    const result = WilliamsR.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      close: bars.map((b) => b.close),
      period,
    });
    return { williamsR: padLeft(result, bars.length) };
  },

  ICHIMOKU: (bars, params) => {
    const result = IchimokuCloud.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      conversionPeriod: params.conversionPeriod ?? 9,
      basePeriod: params.basePeriod ?? 26,
      spanPeriod: params.spanPeriod ?? 52,
      displacement: params.displacement ?? 26,
    });
    return {
      conversion: padLeft(result.map((r) => r.conversion), bars.length),
      base: padLeft(result.map((r) => r.base), bars.length),
      spanA: padLeft(result.map((r) => r.spanA), bars.length),
      spanB: padLeft(result.map((r) => r.spanB), bars.length),
    };
  },

  PSAR: (bars, params) => {
    const result = PSAR.calculate({
      high: bars.map((b) => b.high),
      low: bars.map((b) => b.low),
      step: params.step ?? 0.02,
      max: params.max ?? 0.2,
    });
    return { psar: padLeft(result as number[], bars.length) };
  },

  ROC: (bars, params) => {
    const period = params.period ?? 12;
    const result = ROC.calculate({
      period,
      values: bars.map((b) => b.close),
    });
    return { roc: padLeft(result, bars.length) };
  },

  STOCH_RSI: (bars, params) => {
    const result = StochasticRSI.calculate({
      rsiPeriod: params.rsiPeriod ?? 14,
      stochasticPeriod: params.stochasticPeriod ?? 14,
      kPeriod: params.kPeriod ?? 3,
      dPeriod: params.dPeriod ?? 3,
      values: bars.map((b) => b.close),
    });
    return {
      stochRsi: padLeft(result.map((r) => r.stpiRSI), bars.length),
      k: padLeft(result.map((r) => r.k), bars.length),
      d: padLeft(result.map((r) => r.d), bars.length),
    };
  },
};

export function computeIndicator(
  type: IndicatorType,
  bars: OHLCV[],
  params: Record<string, number> = {},
): Record<string, (number | null)[]> {
  const computer = computers[type];
  if (!computer) throw new Error(`Unknown indicator type: ${type}`);
  return computer(bars, params);
}
