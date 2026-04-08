import { describe, it, expect } from 'vitest';
import { transpile } from '../index';

const RSI_SCRIPT = `
//@version=5
indicator("My RSI", overlay=false)
length = 14
src = close
rsiValue = ta.rsi(src, length)
plot(rsiValue, title="RSI")
hline(70)
hline(30)
`;

const SMA_CROSS = `
//@version=5
indicator("SMA Cross")
fast = ta.sma(close, 10)
slow = ta.sma(close, 20)
bullish = ta.crossover(fast, slow)
if bullish
    alert("Bullish crossover!")
plot(fast, title="Fast SMA")
plot(slow, title="Slow SMA")
`;

const FUNC_SCRIPT = `
//@version=5
indicator("Custom Function")
myFunc(a, b) =>
    a + b * 2
result = myFunc(close, 10)
plot(result)
`;

describe('Transpiler – TypeScript', () => {
  it('transpiles RSI indicator', () => {
    const result = transpile(RSI_SCRIPT, 'typescript');
    expect(result.version).toBe(5);
    expect(result.target).toBe('typescript');
    expect(result.code).toContain('RSI.calculate');
    expect(result.code).toContain('const rsiValue');
    expect(result.code).toContain('/* plot');
  });

  it('transpiles SMA crossover', () => {
    const result = transpile(SMA_CROSS, 'typescript');
    expect(result.code).toContain('SMA.calculate');
    expect(result.code).toContain('const fast');
    expect(result.code).toContain('const slow');
    expect(result.code).toContain('if (');
  });

  it('transpiles custom functions', () => {
    const result = transpile(FUNC_SCRIPT, 'typescript');
    expect(result.code).toContain('function myFunc');
    expect(result.code).toContain('return (');
  });

  it('maps boolean operators to JS equivalents', () => {
    const result = transpile('x = a and b or c\n', 'typescript');
    expect(result.code).toContain('&&');
    expect(result.code).toContain('||');
  });

  it('maps na to NaN', () => {
    const result = transpile('x = na\n', 'typescript');
    expect(result.code).toContain('NaN');
  });
});

describe('Transpiler – Python', () => {
  it('transpiles RSI indicator', () => {
    const result = transpile(RSI_SCRIPT, 'python');
    expect(result.version).toBe(5);
    expect(result.target).toBe('python');
    expect(result.code).toContain('.ta.rsi');
    expect(result.code).toContain('rsiValue =');
    expect(result.code).toContain('import pandas');
  });

  it('transpiles SMA crossover', () => {
    const result = transpile(SMA_CROSS, 'python');
    expect(result.code).toContain('.ta.sma');
    expect(result.code).toContain('if ');
  });

  it('transpiles custom functions', () => {
    const result = transpile(FUNC_SCRIPT, 'python');
    expect(result.code).toContain('def myFunc');
  });

  it('maps booleans to Python True/False', () => {
    const result = transpile('x = true\ny = false\n', 'python');
    expect(result.code).toContain('True');
    expect(result.code).toContain('False');
  });

  it('maps na to np.nan', () => {
    const result = transpile('x = na\n', 'python');
    expect(result.code).toContain('np.nan');
  });
});
