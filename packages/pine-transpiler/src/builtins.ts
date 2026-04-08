// ── PineScript Built-in Function Mappings ────────────
// Maps PineScript built-in functions to TypeScript and Python equivalents.

export interface BuiltinMapping {
  /** PineScript function name (e.g. "ta.sma") */
  pine: string;
  /** TypeScript equivalent */
  ts: {
    /** Import source (npm package / module) */
    module: string;
    /** Function or expression template.  Use $0..$N for positional args. */
    template: string;
  };
  /** Python equivalent */
  py: {
    module: string;
    template: string;
  };
  /** Minimum required positional args */
  minArgs: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const BUILTINS: Record<string, BuiltinMapping> = {
  // ─── Technical-analysis indicators ──────────────────────────────────
  'ta.sma': {
    pine: 'ta.sma',
    ts: { module: 'technicalindicators', template: 'SMA.calculate({ period: $1, values: $0 })' },
    py: { module: 'pandas_ta', template: '$0.ta.sma(length=$1)' },
    minArgs: 2,
  },
  'ta.ema': {
    pine: 'ta.ema',
    ts: { module: 'technicalindicators', template: 'EMA.calculate({ period: $1, values: $0 })' },
    py: { module: 'pandas_ta', template: '$0.ta.ema(length=$1)' },
    minArgs: 2,
  },
  'ta.wma': {
    pine: 'ta.wma',
    ts: { module: 'technicalindicators', template: 'WMA.calculate({ period: $1, values: $0 })' },
    py: { module: 'pandas_ta', template: '$0.ta.wma(length=$1)' },
    minArgs: 2,
  },
  'ta.vwma': {
    pine: 'ta.vwma',
    ts: { module: 'technicalindicators', template: 'VWMA.calculate({ period: $2, values: $0, volumes: $1 })' },
    py: { module: 'pandas_ta', template: '$0.ta.vwma(length=$2, volume=$1)' },
    minArgs: 2,
  },
  'ta.rsi': {
    pine: 'ta.rsi',
    ts: { module: 'technicalindicators', template: 'RSI.calculate({ period: $1, values: $0 })' },
    py: { module: 'pandas_ta', template: '$0.ta.rsi(length=$1)' },
    minArgs: 2,
  },
  'ta.macd': {
    pine: 'ta.macd',
    ts: {
      module: 'technicalindicators',
      template: 'MACD.calculate({ values: $0, fastPeriod: $1, slowPeriod: $2, signalPeriod: $3 })',
    },
    py: { module: 'pandas_ta', template: '$0.ta.macd(fast=$1, slow=$2, signal=$3)' },
    minArgs: 4,
  },
  'ta.bb': {
    pine: 'ta.bb',
    ts: {
      module: 'technicalindicators',
      template: 'BollingerBands.calculate({ period: $1, stdDev: $2, values: $0 })',
    },
    py: { module: 'pandas_ta', template: '$0.ta.bbands(length=$1, std=$2)' },
    minArgs: 3,
  },
  'ta.stoch': {
    pine: 'ta.stoch',
    ts: {
      module: 'technicalindicators',
      template: 'Stochastic.calculate({ high: $0, low: $1, close: $2, period: $3, signalPeriod: $4 })',
    },
    py: { module: 'pandas_ta', template: 'pandas_ta.stoch(high=$0, low=$1, close=$2, k=$3, d=$4)' },
    minArgs: 5,
  },
  'ta.atr': {
    pine: 'ta.atr',
    ts: {
      module: 'technicalindicators',
      template: 'ATR.calculate({ period: $0, high: highSeries, low: lowSeries, close: closeSeries })',
    },
    py: { module: 'pandas_ta', template: 'pandas_ta.atr(high=high, low=low, close=close, length=$0)' },
    minArgs: 1,
  },
  'ta.supertrend': {
    pine: 'ta.supertrend',
    ts: { module: 'technicalindicators', template: 'SuperTrend.calculate({ period: $1, multiplier: $0 })' },
    py: { module: 'pandas_ta', template: 'pandas_ta.supertrend(length=$1, multiplier=$0)' },
    minArgs: 2,
  },

  // ─── Cross / crossover / crossunder ────────────────────────────────
  'ta.crossover': {
    pine: 'ta.crossover',
    ts: { module: '__inline', template: '(($0)[i] > ($1)[i] && ($0)[i-1] <= ($1)[i-1])' },
    py: { module: '__inline', template: '(($0).iloc[i] > ($1).iloc[i]) & (($0).iloc[i-1] <= ($1).iloc[i-1])' },
    minArgs: 2,
  },
  'ta.crossunder': {
    pine: 'ta.crossunder',
    ts: { module: '__inline', template: '(($0)[i] < ($1)[i] && ($0)[i-1] >= ($1)[i-1])' },
    py: { module: '__inline', template: '(($0).iloc[i] < ($1).iloc[i]) & (($0).iloc[i-1] >= ($1).iloc[i-1])' },
    minArgs: 2,
  },
  'ta.cross': {
    pine: 'ta.cross',
    ts: { module: '__inline', template: '(($0)[i] !== ($1)[i] && ($0)[i-1] === ($1)[i-1])' },
    py: { module: '__inline', template: '(($0).iloc[i] != ($1).iloc[i]) & (($0).iloc[i-1] == ($1).iloc[i-1])' },
    minArgs: 2,
  },

  // ─── Highest / lowest ─────────────────────────────────────────────
  'ta.highest': {
    pine: 'ta.highest',
    ts: { module: '__inline', template: 'Math.max(...($0).slice(i - $1 + 1, i + 1))' },
    py: { module: '__inline', template: '($0).rolling($1).max()' },
    minArgs: 2,
  },
  'ta.lowest': {
    pine: 'ta.lowest',
    ts: { module: '__inline', template: 'Math.min(...($0).slice(i - $1 + 1, i + 1))' },
    py: { module: '__inline', template: '($0).rolling($1).min()' },
    minArgs: 2,
  },

  // ─── Math functions ─────────────────────────────────────────────
  'math.abs': {
    pine: 'math.abs',
    ts: { module: '__builtin', template: 'Math.abs($0)' },
    py: { module: '__builtin', template: 'abs($0)' },
    minArgs: 1,
  },
  'math.max': {
    pine: 'math.max',
    ts: { module: '__builtin', template: 'Math.max($0, $1)' },
    py: { module: '__builtin', template: 'max($0, $1)' },
    minArgs: 2,
  },
  'math.min': {
    pine: 'math.min',
    ts: { module: '__builtin', template: 'Math.min($0, $1)' },
    py: { module: '__builtin', template: 'min($0, $1)' },
    minArgs: 2,
  },
  'math.round': {
    pine: 'math.round',
    ts: { module: '__builtin', template: 'Math.round($0)' },
    py: { module: '__builtin', template: 'round($0)' },
    minArgs: 1,
  },
  'math.ceil': {
    pine: 'math.ceil',
    ts: { module: '__builtin', template: 'Math.ceil($0)' },
    py: { module: 'math', template: 'math.ceil($0)' },
    minArgs: 1,
  },
  'math.floor': {
    pine: 'math.floor',
    ts: { module: '__builtin', template: 'Math.floor($0)' },
    py: { module: 'math', template: 'math.floor($0)' },
    minArgs: 1,
  },
  'math.sqrt': {
    pine: 'math.sqrt',
    ts: { module: '__builtin', template: 'Math.sqrt($0)' },
    py: { module: 'math', template: 'math.sqrt($0)' },
    minArgs: 1,
  },
  'math.pow': {
    pine: 'math.pow',
    ts: { module: '__builtin', template: 'Math.pow($0, $1)' },
    py: { module: '__builtin', template: '($0) ** ($1)' },
    minArgs: 2,
  },
  'math.log': {
    pine: 'math.log',
    ts: { module: '__builtin', template: 'Math.log($0)' },
    py: { module: 'math', template: 'math.log($0)' },
    minArgs: 1,
  },
  'math.log10': {
    pine: 'math.log10',
    ts: { module: '__builtin', template: 'Math.log10($0)' },
    py: { module: 'math', template: 'math.log10($0)' },
    minArgs: 1,
  },
  'math.sign': {
    pine: 'math.sign',
    ts: { module: '__builtin', template: 'Math.sign($0)' },
    py: { module: '__inline', template: '(1 if $0 > 0 else (-1 if $0 < 0 else 0))' },
    minArgs: 1,
  },
  'math.avg': {
    pine: 'math.avg',
    ts: { module: '__inline', template: '([$0].reduce((a, b) => a + b, 0) / [$0].length)' },
    py: { module: 'statistics', template: 'statistics.mean([$0])' },
    minArgs: 1,
  },
  'math.sum': {
    pine: 'math.sum',
    ts: { module: '__inline', template: '([$0].reduce((a, b) => a + b, 0))' },
    py: { module: '__builtin', template: 'sum([$0])' },
    minArgs: 1,
  },

  // ─── Input functions ─────────────────────────────────────────────
  'input': {
    pine: 'input',
    ts: { module: '__inline', template: '/* input */ $0' },
    py: { module: '__inline', template: '# input\n$0' },
    minArgs: 1,
  },
  'input.int': {
    pine: 'input.int',
    ts: { module: '__inline', template: '/* input.int */ $0 as number' },
    py: { module: '__inline', template: '# input.int\nint($0)' },
    minArgs: 1,
  },
  'input.float': {
    pine: 'input.float',
    ts: { module: '__inline', template: '/* input.float */ $0 as number' },
    py: { module: '__inline', template: '# input.float\nfloat($0)' },
    minArgs: 1,
  },
  'input.bool': {
    pine: 'input.bool',
    ts: { module: '__inline', template: '/* input.bool */ $0 as boolean' },
    py: { module: '__inline', template: '# input.bool\nbool($0)' },
    minArgs: 1,
  },
  'input.string': {
    pine: 'input.string',
    ts: { module: '__inline', template: '/* input.string */ $0 as string' },
    py: { module: '__inline', template: '# input.string\nstr($0)' },
    minArgs: 1,
  },
  'input.source': {
    pine: 'input.source',
    ts: { module: '__inline', template: '/* input.source */ $0' },
    py: { module: '__inline', template: '# input.source\n$0' },
    minArgs: 1,
  },

  // ─── String functions ────────────────────────────────────────────
  'str.tostring': {
    pine: 'str.tostring',
    ts: { module: '__builtin', template: 'String($0)' },
    py: { module: '__builtin', template: 'str($0)' },
    minArgs: 1,
  },
  'str.tonumber': {
    pine: 'str.tonumber',
    ts: { module: '__builtin', template: 'parseFloat($0)' },
    py: { module: '__builtin', template: 'float($0)' },
    minArgs: 1,
  },
  'str.length': {
    pine: 'str.length',
    ts: { module: '__builtin', template: '($0).length' },
    py: { module: '__builtin', template: 'len($0)' },
    minArgs: 1,
  },
  'str.contains': {
    pine: 'str.contains',
    ts: { module: '__builtin', template: '($0).includes($1)' },
    py: { module: '__builtin', template: '($1) in ($0)' },
    minArgs: 2,
  },
  'str.replace_all': {
    pine: 'str.replace_all',
    ts: { module: '__builtin', template: '($0).replaceAll($1, $2)' },
    py: { module: '__builtin', template: '($0).replace($1, $2)' },
    minArgs: 3,
  },

  // ─── Array functions ─────────────────────────────────────────────
  'array.new_float': {
    pine: 'array.new_float',
    ts: { module: '__builtin', template: 'new Array<number>($0).fill($1 ?? 0)' },
    py: { module: '__builtin', template: '[$1 or 0.0] * $0' },
    minArgs: 1,
  },
  'array.new_int': {
    pine: 'array.new_int',
    ts: { module: '__builtin', template: 'new Array<number>($0).fill($1 ?? 0)' },
    py: { module: '__builtin', template: '[$1 or 0] * $0' },
    minArgs: 1,
  },
  'array.push': {
    pine: 'array.push',
    ts: { module: '__builtin', template: '($0).push($1)' },
    py: { module: '__builtin', template: '($0).append($1)' },
    minArgs: 2,
  },
  'array.pop': {
    pine: 'array.pop',
    ts: { module: '__builtin', template: '($0).pop()' },
    py: { module: '__builtin', template: '($0).pop()' },
    minArgs: 1,
  },
  'array.get': {
    pine: 'array.get',
    ts: { module: '__builtin', template: '($0)[$1]' },
    py: { module: '__builtin', template: '($0)[$1]' },
    minArgs: 2,
  },
  'array.set': {
    pine: 'array.set',
    ts: { module: '__inline', template: '($0)[$1] = $2' },
    py: { module: '__inline', template: '($0)[$1] = $2' },
    minArgs: 3,
  },
  'array.size': {
    pine: 'array.size',
    ts: { module: '__builtin', template: '($0).length' },
    py: { module: '__builtin', template: 'len($0)' },
    minArgs: 1,
  },

  // ─── Plot / output (no-ops in non-chart context) ───────────────────
  'plot': {
    pine: 'plot',
    ts: { module: '__inline', template: '/* plot($0) */' },
    py: { module: '__inline', template: '# plot($0)' },
    minArgs: 1,
  },
  'plotshape': {
    pine: 'plotshape',
    ts: { module: '__inline', template: '/* plotshape($0) */' },
    py: { module: '__inline', template: '# plotshape($0)' },
    minArgs: 1,
  },
  'plotchar': {
    pine: 'plotchar',
    ts: { module: '__inline', template: '/* plotchar($0) */' },
    py: { module: '__inline', template: '# plotchar($0)' },
    minArgs: 1,
  },
  'hline': {
    pine: 'hline',
    ts: { module: '__inline', template: '/* hline($0) */' },
    py: { module: '__inline', template: '# hline($0)' },
    minArgs: 1,
  },
  'bgcolor': {
    pine: 'bgcolor',
    ts: { module: '__inline', template: '/* bgcolor($0) */' },
    py: { module: '__inline', template: '# bgcolor($0)' },
    minArgs: 1,
  },
  'barcolor': {
    pine: 'barcolor',
    ts: { module: '__inline', template: '/* barcolor($0) */' },
    py: { module: '__inline', template: '# barcolor($0)' },
    minArgs: 1,
  },
  'fill': {
    pine: 'fill',
    ts: { module: '__inline', template: '/* fill($0, $1) */' },
    py: { module: '__inline', template: '# fill($0, $1)' },
    minArgs: 2,
  },

  // ─── Alert ─────────────────────────────────────────────────────────
  'alert': {
    pine: 'alert',
    ts: { module: '__inline', template: 'console.log("Alert:", $0)' },
    py: { module: '__builtin', template: 'print("Alert:", $0)' },
    minArgs: 1,
  },
  'alertcondition': {
    pine: 'alertcondition',
    ts: { module: '__inline', template: '/* alertcondition($0) */' },
    py: { module: '__inline', template: '# alertcondition($0)' },
    minArgs: 1,
  },

  // ─── Strategy functions ────────────────────────────────────────────
  'strategy.entry': {
    pine: 'strategy.entry',
    ts: { module: '__inline', template: '/* strategy.entry($0, $1) */' },
    py: { module: '__inline', template: '# strategy.entry($0, $1)' },
    minArgs: 2,
  },
  'strategy.close': {
    pine: 'strategy.close',
    ts: { module: '__inline', template: '/* strategy.close($0) */' },
    py: { module: '__inline', template: '# strategy.close($0)' },
    minArgs: 1,
  },
  'strategy.exit': {
    pine: 'strategy.exit',
    ts: { module: '__inline', template: '/* strategy.exit($0) */' },
    py: { module: '__inline', template: '# strategy.exit($0)' },
    minArgs: 1,
  },
  'strategy.cancel': {
    pine: 'strategy.cancel',
    ts: { module: '__inline', template: '/* strategy.cancel($0) */' },
    py: { module: '__inline', template: '# strategy.cancel($0)' },
    minArgs: 1,
  },

  // ─── Color helpers ─────────────────────────────────────────────────
  'color.new': {
    pine: 'color.new',
    ts: { module: '__inline', template: '$0 /* alpha=$1 */' },
    py: { module: '__inline', template: '$0  # alpha=$1' },
    minArgs: 2,
  },
  'color.rgb': {
    pine: 'color.rgb',
    ts: { module: '__inline', template: '`rgba(${$0},${$1},${$2},${1 - ($3 ?? 0) / 100})`' },
    py: { module: '__inline', template: "f'rgba({$0},{$1},{$2},{1 - ($3 or 0)/100})'" },
    minArgs: 3,
  },

  // ─── nz / na ───────────────────────────────────────────────────────
  'nz': {
    pine: 'nz',
    ts: { module: '__inline', template: '($0 ?? $1 ?? 0)' },
    py: { module: '__inline', template: '($0 if $0 is not None else ($1 if $1 is not None else 0))' },
    minArgs: 1,
  },
  'na': {
    pine: 'na',
    ts: { module: '__inline', template: '($0 == null || Number.isNaN($0))' },
    py: { module: 'math', template: '($0 is None or math.isnan($0))' },
    minArgs: 1,
  },
  'fixnan': {
    pine: 'fixnan',
    ts: { module: '__inline', template: '(Number.isNaN($0) ? lastValidValue : $0)' },
    py: { module: 'pandas', template: '($0).ffill()' },
    minArgs: 1,
  },

  // ─── Timeframe / session ──────────────────────────────────────────
  'timeframe.period': {
    pine: 'timeframe.period',
    ts: { module: '__inline', template: 'timeframe' },
    py: { module: '__inline', template: 'timeframe' },
    minArgs: 0,
  },
  'syminfo.ticker': {
    pine: 'syminfo.ticker',
    ts: { module: '__inline', template: 'ticker' },
    py: { module: '__inline', template: 'ticker' },
    minArgs: 0,
  },

  // ─── ta.change / ta.mom etc. ──────────────────────────────────────
  'ta.change': {
    pine: 'ta.change',
    ts: { module: '__inline', template: '(($0)[i] - ($0)[i - ($1 ?? 1)])' },
    py: { module: '__inline', template: '($0).diff(periods=($1 or 1))' },
    minArgs: 1,
  },
  'ta.valuewhen': {
    pine: 'ta.valuewhen',
    ts: { module: '__inline', template: '/* ta.valuewhen($0, $1, $2) */' },
    py: { module: '__inline', template: '# ta.valuewhen($0, $1, $2)' },
    minArgs: 3,
  },
  'ta.barssince': {
    pine: 'ta.barssince',
    ts: { module: '__inline', template: '/* ta.barssince($0) */' },
    py: { module: '__inline', template: '# ta.barssince($0)' },
    minArgs: 1,
  },
  'ta.cum': {
    pine: 'ta.cum',
    ts: { module: '__inline', template: '($0).reduce((acc: number, v: number) => acc + v, 0)' },
    py: { module: '__inline', template: '($0).cumsum()' },
    minArgs: 1,
  },
  'ta.stdev': {
    pine: 'ta.stdev',
    ts: {
      module: 'technicalindicators',
      template: 'SD.calculate({ period: $1, values: $0 })',
    },
    py: { module: '__inline', template: '($0).rolling($1).std()' },
    minArgs: 2,
  },
  'ta.correlation': {
    pine: 'ta.correlation',
    ts: { module: '__inline', template: '/* ta.correlation($0, $1, $2) */' },
    py: { module: '__inline', template: '($0).rolling($2).corr($1)' },
    minArgs: 3,
  },
  'ta.pivothigh': {
    pine: 'ta.pivothigh',
    ts: { module: '__inline', template: '/* ta.pivothigh($0, $1, $2) */' },
    py: { module: '__inline', template: '# ta.pivothigh($0, $1, $2)' },
    minArgs: 3,
  },
  'ta.pivotlow': {
    pine: 'ta.pivotlow',
    ts: { module: '__inline', template: '/* ta.pivotlow($0, $1, $2) */' },
    py: { module: '__inline', template: '# ta.pivotlow($0, $1, $2)' },
    minArgs: 3,
  },
};

/**
 * Resolve a PineScript call name to its mapping object.
 * Supports both `ta.sma` and dot-qualified forms.
 */
export function resolveBuiltin(name: string): BuiltinMapping | undefined {
  return BUILTINS[name];
}

/**
 * Apply positional arguments to a template string.
 * $0, $1, … are replaced with the given arg strings.
 * Excess $N placeholders are left as-is.
 */
export function applyTemplate(template: string, args: string[]): string {
  let result = template;
  for (let i = 0; i < args.length; i++) {
    result = result.replaceAll(`$${i}`, args[i]);
  }
  return result;
}
