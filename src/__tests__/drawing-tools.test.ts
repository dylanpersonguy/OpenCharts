import { describe, expect, it } from "vitest";
import { hitTest } from "@/lib/chart-plugins/drawing-tools/hit-test";
import type { ResolvedEntry } from "@/lib/chart-plugins/drawing-tools/types";
import type { DrawingLine } from "@/pages/trading/constants";

/**
 * The rectangle's eight resize handles: four corners (both axes) and four
 * mid-edge points (one axis each), TradingView-style.
 *
 * Pane coordinates here: x grows right, y grows down; the resolver has already
 * turned prices into y, so the test only cares about the geometry.
 */

function rectangle(overrides: Partial<ResolvedEntry> = {}): ResolvedEntry {
  const d: DrawingLine = {
    id: "rect-1",
    type: "rectangle",
    price: 100,
    price2: 90,
    time: 1_700_000_000,
    time2: 1_700_003_600,
    color: "#2196F3",
  };
  return {
    d,
    x1: 100,
    y1: 100,
    x2: 300,
    y2: 200,
    state: "selected",
    ...overrides,
  };
}

function hitAt(entry: ResolvedEntry, x: number, y: number) {
  return hitTest([entry], { x, y });
}

function point(entry: ResolvedEntry, x: number, y: number) {
  const hit = hitAt(entry, x, y);
  expect(hit?.region.kind).toBe("point");
  return hit?.region.kind === "point" ? hit.region : null;
}

describe("rectangle resize handles", () => {
  it("keeps the four corner handles on both axes", () => {
    const rect = rectangle();
    expect(point(rect, 100, 100)).toMatchObject({
      timeKey: "time",
      priceKey: "price",
      cursor: "nwse-resize",
    });
    expect(point(rect, 300, 200)).toMatchObject({
      timeKey: "time2",
      priceKey: "price2",
      cursor: "nwse-resize",
    });
    expect(point(rect, 100, 200)).toMatchObject({
      timeKey: "time",
      priceKey: "price2",
      cursor: "nesw-resize",
    });
    expect(point(rect, 300, 100)).toMatchObject({
      timeKey: "time2",
      priceKey: "price",
      cursor: "nesw-resize",
    });
  });

  it("adds a mid-edge handle for every side that moves one axis", () => {
    const rect = rectangle();
    expect(point(rect, 200, 100)).toMatchObject({
      timeKey: null,
      priceKey: "price",
      cursor: "ns-resize",
    });
    expect(point(rect, 200, 200)).toMatchObject({
      timeKey: null,
      priceKey: "price2",
      cursor: "ns-resize",
    });
    expect(point(rect, 100, 150)).toMatchObject({
      timeKey: "time",
      priceKey: null,
      cursor: "ew-resize",
    });
    expect(point(rect, 300, 150)).toMatchObject({
      timeKey: "time2",
      priceKey: null,
      cursor: "ew-resize",
    });
  });

  it("maps the edge handle to the visible side when the rectangle is drawn in reverse", () => {
    // Drawn from bottom-right to top-left: time2/y2 is now the top-left side.
    const rect = rectangle({ x1: 300, y1: 200, x2: 100, y2: 100 });
    expect(point(rect, 200, 100)).toMatchObject({ timeKey: null, priceKey: "price2" });
    expect(point(rect, 200, 200)).toMatchObject({ timeKey: null, priceKey: "price" });
    expect(point(rect, 100, 150)).toMatchObject({ timeKey: "time2", priceKey: null });
    expect(point(rect, 300, 150)).toMatchObject({ timeKey: "time", priceKey: null });
  });

  it("keeps the body draggable away from the handles", () => {
    const rect = rectangle();
    expect(hitAt(rect, 200, 150)?.region.kind).toBe("body");
    expect(hitAt(rect, 200, 110)?.region.kind).toBe("body");
  });

  it("does not treat an ellipse's bounding-box edge as a handle", () => {
    const ellipse = rectangle({
      d: {
        id: "ellipse-1",
        type: "ellipse",
        price: 100,
        price2: 90,
        time: 1_700_000_000,
        time2: 1_700_003_600,
        color: "#2196F3",
      },
    });
    expect(hitAt(ellipse, 200, 100)?.region.kind).toBe("body");
    // Corners still resize it.
    expect(point(ellipse, 100, 100)).toMatchObject({ timeKey: "time", priceKey: "price" });
  });

  it("still returns nothing outside the rectangle", () => {
    expect(hitAt(rectangle(), 500, 500)).toBeNull();
  });
});
