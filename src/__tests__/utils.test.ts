import { describe, it, expect } from "vitest";
import { cn, formatCurrency, formatNumber, pnlClass } from "@/lib/utils";

describe("cn (class name merge)", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles undefined and null", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    const hide = false;
    const show = true;
    expect(cn("base", hide && "hidden", show && "visible")).toBe("base visible");
  });

  it("resolves Tailwind conflicts (last wins)", () => {
    const result = cn("p-4", "p-6");
    expect(result).toBe("p-6");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });
});

describe("formatCurrency", () => {
  it("formats positive numbers", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negative numbers", () => {
    expect(formatCurrency(-500)).toBe("-$500.00");
  });

  it("respects custom decimals", () => {
    expect(formatCurrency(100, 0)).toBe("$100");
  });

  it("formats large numbers with commas", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
  });
});

describe("formatNumber", () => {
  it("formats with default 2 decimals", () => {
    expect(formatNumber(1234.5)).toBe("1,234.50");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0.00");
  });

  it("respects custom decimals", () => {
    expect(formatNumber(3.14159, 4)).toBe("3.1416");
  });
});

describe("pnlClass", () => {
  it("returns success for positive values", () => {
    expect(pnlClass(100)).toBe("text-success");
  });

  it("returns destructive for negative values", () => {
    expect(pnlClass(-50)).toBe("text-destructive");
  });

  it("returns muted for zero", () => {
    expect(pnlClass(0)).toBe("text-muted-foreground");
  });
});
