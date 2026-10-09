import { describe, it, expect } from "vitest";
import { diffSeries } from "./series-diff.ts";

const bar = (time: number, close = 1) => ({ time, open: 1, high: 1, low: 1, close });

describe("diffSeries", () => {
  it("resets when there is no previous data", () => {
    expect(diffSeries([], [bar(1)])).toEqual({ kind: "reset" });
  });

  it("updates only the last bar when it was replaced in place", () => {
    const a = bar(1);
    const b = bar(2);
    const b2 = bar(2, 5);
    expect(diffSeries([a, b], [a, b2])).toEqual({ kind: "update", bars: [b2] });
  });

  it("updates the last bar and appends one new bar", () => {
    const a = bar(1);
    const b = bar(2);
    const b2 = bar(2, 5);
    const c = bar(3);
    expect(diffSeries([a, b], [a, b2, c])).toEqual({ kind: "update", bars: [b2, c] });
  });

  it("returns none when nothing changed", () => {
    const a = bar(1);
    const b = bar(2);
    expect(diffSeries([a, b], [a, b])).toEqual({ kind: "none" });
  });

  it("resets when the first bar moved (new window) or history was rewritten", () => {
    const a = bar(1);
    const b = bar(2);
    expect(diffSeries([a, b], [bar(0), a, b])).toEqual({ kind: "reset" });
    expect(diffSeries([a, b, bar(3)], [a, bar(2, 9), bar(3)])).toEqual({ kind: "reset" });
  });

  it("resets when more than one bar was appended or bars were removed", () => {
    const a = bar(1);
    const b = bar(2);
    expect(diffSeries([a], [a, b, bar(3)])).toEqual({ kind: "reset" });
    expect(diffSeries([a, b], [a])).toEqual({ kind: "reset" });
  });
});
