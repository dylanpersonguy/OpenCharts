import { describe, expect, it } from "vitest";
import { pathSegments, pricePath } from "./intrabar.ts";
import { bar } from "./test-utils.ts";

describe("pricePath", () => {
  it("goes to the high first when the open is nearer the high", () => {
    expect(pricePath(bar(0, 100, 102, 90, 95))).toEqual([100, 102, 90, 95]);
  });

  it("goes to the low first when the open is nearer the low", () => {
    expect(pricePath(bar(0, 100, 110, 99, 105))).toEqual([100, 99, 110, 105]);
  });

  it("breaks an exact tie towards the high first", () => {
    expect(pricePath(bar(0, 100, 105, 95, 100))).toEqual([100, 105, 95, 100]);
  });
});

describe("pathSegments", () => {
  it("returns the three legs of the path", () => {
    expect(pathSegments(bar(0, 100, 102, 90, 95))).toEqual([
      { from: 100, to: 102 },
      { from: 102, to: 90 },
      { from: 90, to: 95 },
    ]);
  });

  it("drops zero-length legs", () => {
    expect(pathSegments(bar(0, 100, 100, 90, 90))).toEqual([{ from: 100, to: 90 }]);
    expect(pathSegments(bar(0, 100, 100, 100, 100))).toEqual([]);
  });
});
