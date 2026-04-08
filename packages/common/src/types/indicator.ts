export type IndicatorType =
  | 'SMA' | 'EMA' | 'WMA' | 'DEMA' | 'TEMA'
  | 'VWAP' | 'RSI' | 'MACD' | 'BBANDS'
  | 'STOCH' | 'ATR' | 'ADX' | 'CCI' | 'MFI'
  | 'OBV' | 'WILLIAMS_R' | 'ICHIMOKU' | 'PSAR'
  | 'ROC' | 'STOCH_RSI';

export type IndicatorPane = 'overlay' | 'lower';

export interface IndicatorConfig {
  type: IndicatorType;
  name: string;
  description: string;
  pane: IndicatorPane;
  defaultParams: Record<string, number>;
  paramLabels: Record<string, string>;
}

export interface IndicatorInput {
  type: IndicatorType;
  params: Record<string, number>;
}

export interface IndicatorOutput {
  type: IndicatorType;
  /** Each series is a named line, e.g. { sma: [...values] } */
  series: Record<string, (number | null)[]>;
}

export const INDICATOR_REGISTRY: IndicatorConfig[] = [
  {
    type: 'SMA',
    name: 'Simple Moving Average',
    description: 'Average of the last N closing prices',
    pane: 'overlay',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'EMA',
    name: 'Exponential Moving Average',
    description: 'Weighted average emphasizing recent prices',
    pane: 'overlay',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'VWAP',
    name: 'Volume Weighted Average Price',
    description: 'Average price weighted by volume',
    pane: 'overlay',
    defaultParams: {},
    paramLabels: {},
  },
  {
    type: 'RSI',
    name: 'Relative Strength Index',
    description: 'Momentum oscillator measuring speed and change of price movements',
    pane: 'lower',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'MACD',
    name: 'Moving Average Convergence Divergence',
    description: 'Trend-following momentum indicator',
    pane: 'lower',
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramLabels: { fast: 'Fast Period', slow: 'Slow Period', signal: 'Signal Period' },
  },
  {
    type: 'BBANDS',
    name: 'Bollinger Bands',
    description: 'Volatility bands around a moving average',
    pane: 'overlay',
    defaultParams: { period: 20, stddev: 2 },
    paramLabels: { period: 'Period', stddev: 'Std Deviations' },
  },
  {
    type: 'STOCH',
    name: 'Stochastic Oscillator',
    description: 'Compares closing price to price range over a period',
    pane: 'lower',
    defaultParams: { period: 14, signalPeriod: 3 },
    paramLabels: { period: 'Period', signalPeriod: 'Signal Period' },
  },
  {
    type: 'ATR',
    name: 'Average True Range',
    description: 'Measures market volatility',
    pane: 'lower',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'ADX',
    name: 'Average Directional Index',
    description: 'Measures trend strength',
    pane: 'lower',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'CCI',
    name: 'Commodity Channel Index',
    description: 'Identifies cyclical trends',
    pane: 'lower',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'MFI',
    name: 'Money Flow Index',
    description: 'Volume-weighted RSI',
    pane: 'lower',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'OBV',
    name: 'On-Balance Volume',
    description: 'Cumulative volume-based momentum indicator',
    pane: 'lower',
    defaultParams: {},
    paramLabels: {},
  },
  {
    type: 'WILLIAMS_R',
    name: 'Williams %R',
    description: 'Momentum indicator measuring overbought/oversold levels',
    pane: 'lower',
    defaultParams: { period: 14 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'ICHIMOKU',
    name: 'Ichimoku Cloud',
    description: 'Multi-component trend indicator',
    pane: 'overlay',
    defaultParams: { conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 },
    paramLabels: { conversionPeriod: 'Conversion', basePeriod: 'Base', spanPeriod: 'Span', displacement: 'Displacement' },
  },
  {
    type: 'PSAR',
    name: 'Parabolic SAR',
    description: 'Trend direction and potential reversal points',
    pane: 'overlay',
    defaultParams: { step: 0.02, max: 0.2 },
    paramLabels: { step: 'Step', max: 'Max' },
  },
  {
    type: 'WMA',
    name: 'Weighted Moving Average',
    description: 'Moving average with linear weight distribution',
    pane: 'overlay',
    defaultParams: { period: 20 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'ROC',
    name: 'Rate of Change',
    description: 'Percentage change between current and N-period ago price',
    pane: 'lower',
    defaultParams: { period: 12 },
    paramLabels: { period: 'Period' },
  },
  {
    type: 'STOCH_RSI',
    name: 'Stochastic RSI',
    description: 'Stochastic oscillator applied to RSI values',
    pane: 'lower',
    defaultParams: { rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 },
    paramLabels: { rsiPeriod: 'RSI Period', stochasticPeriod: 'Stoch Period', kPeriod: 'K Period', dPeriod: 'D Period' },
  },
];
