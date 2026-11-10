// Tests for the pure logic in scripts/builder/lib.ts (vitest only globs src/**).
import { describe, expect, it } from "vitest";
import {
  aggregate,
  assertLowercaseAddress,
  builderFillsUrl,
  checkAbstraction,
  checkAccountValue,
  checkApproval,
  checkFeeConfig,
  computeDrift,
  dayRange,
  decodeLz4,
  defaultRange,
  encodeLz4,
  fetchBuilderDay,
  healthExitCode,
  parseArgs,
  parseBuilderFills,
  parseCsv,
  parseDay,
  redact,
  ymd,
} from "../../../scripts/builder/lib";

const HEADER =
  "time,user,coin,side,px,sz,crossed,special_trade_type,tif,is_trigger,counterparty,closed_pnl,twap_id,builder_fee";
const CSV = [
  HEADER,
  "2026-11-08T00:00:05Z,0xaa,ZEC,Ask,1260.5,0.02,true,Na,Ioc,false,0xbb,-0.017,0,0.012605",
  "2026-11-08T00:00:16Z,0xcc,FARTCOIN,Ask,0.11802,3465.4,true,Na,Ioc,false,0xdd,2.8,0,0.204493",
  "2026-11-09T01:00:00Z,0xcc,ZEC,Bid,100,1,true,Na,Ioc,false,0xdd,0,0,0.05",
  "",
].join("\n");

describe("addresses and dates", () => {
  it("requires lowercase addresses", () => {
    expect(assertLowercaseAddress("0x" + "ab".repeat(20))).toBeDefined();
    expect(() => assertLowercaseAddress("0x" + "AB".repeat(20))).toThrow();
    expect(() => assertLowercaseAddress("0x123")).toThrow();
  });
  it("builds the stats URL", () => {
    expect(builderFillsUrl("0x" + "ab".repeat(20), "20261108")).toBe(
      `https://stats-data.hyperliquid.xyz/Mainnet/builder_fills/0x${"ab".repeat(20)}/20261108.csv.lz4`,
    );
  });
  it("parses and ranges days", () => {
    expect(ymd(parseDay("2026-11-08"))).toBe("20261108");
    expect(() => parseDay("20261340")).toThrow();
    expect(dayRange(parseDay("20261230"), parseDay("20270102"))).toEqual(["20261230", "20261231", "20270101", "20270102"]);
    expect(() => dayRange(parseDay("20270102"), parseDay("20261230"))).toThrow();
  });
  it("default range ends yesterday", () => {
    const r = defaultRange(new Date("2026-11-10T12:00:00Z"), 7);
    expect(ymd(r.to)).toBe("20261109");
    expect(ymd(r.from)).toBe("20261103");
  });
});

describe("csv + lz4", () => {
  it("round-trips LZ4 frames", () => {
    const text = CSV.repeat(50);
    expect(decodeLz4(encodeLz4(text))).toBe(text);
  });
  it("parses quoted fields and CRLF", () => {
    expect(parseCsv('a,"b,c",d\r\n1,"x ""y""",3\r\n')).toEqual([
      ["a", "b,c", "d"],
      ["1", 'x "y"', "3"],
    ]);
  });
  it("parses builder fills by header name", () => {
    const p = parseBuilderFills(CSV);
    expect(p.feeColumn).toBe("builder_fee");
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ coin: "ZEC", side: "Ask", day: "20261108", fee: 0.012605 });
    expect(p.rows[0]?.notional).toBeCloseTo(25.21, 6);
  });
  it("is column-order independent", () => {
    const p = parseBuilderFills("builder_fee,coin,time,side\n0.5,BTC,2026-01-02T00:00:00Z,Bid\n");
    expect(p.rows[0]).toMatchObject({ fee: 0.5, coin: "BTC", day: "20260102", notional: 0 });
  });
  it("fails loudly without a builder fee column", () => {
    expect(() => parseBuilderFills("time,coin,side\nx,y,z\n")).toThrow(/no builder-fee-like column.*time, coin, side/);
  });
  it("skips unparsable rows and counts them", () => {
    const p = parseBuilderFills(HEADER + "\nnot-a-time,0x,BTC,Bid,1,1,,,,,,,,abc\n" + CSV.split("\n")[1]);
    expect(p.skipped).toBe(1);
    expect(p.rows).toHaveLength(1);
  });
});

describe("aggregate", () => {
  it("groups by day, market and side", () => {
    const a = aggregate(parseBuilderFills(CSV).rows);
    expect(a.byDay.map((b) => b.key)).toEqual(["20261108", "20261109"]);
    expect(a.byDay[0]?.fee).toBeCloseTo(0.012605 + 0.204493, 9);
    expect(a.byMarket[0]?.key).toBe("FARTCOIN");
    expect(a.bySide.find((b) => b.key === "Bid")?.fills).toBe(1);
    expect(a.total.fills).toBe(3);
    expect(a.total.fee).toBeCloseTo(0.012605 + 0.204493 + 0.05, 9);
  });
});

describe("fetchBuilderDay", () => {
  const addr = "0x" + "ab".repeat(20);
  it("returns null on 404", async () => {
    const f = (async () => new Response("", { status: 404 })) as typeof fetch;
    expect(await fetchBuilderDay(addr, "20261108", "mainnet", f)).toBeNull();
  });
  it("decodes a 200 response", async () => {
    const body = encodeLz4(CSV);
    const f = (async () => new Response(body as BodyInit, { status: 200 })) as typeof fetch;
    const p = await fetchBuilderDay(addr, "20261108", "mainnet", f);
    expect(p?.rows).toHaveLength(3);
  });
  it("throws on server errors", async () => {
    const f = (async () => new Response("", { status: 500 })) as typeof fetch;
    await expect(fetchBuilderDay(addr, "20261108", "mainnet", f)).rejects.toThrow(/HTTP 500/);
  });
});

describe("reconcile drift", () => {
  it("flags above 1% only", () => {
    expect(computeDrift(100, 100.5).flagged).toBe(false);
    expect(computeDrift(100, 98).flagged).toBe(true);
    expect(computeDrift(0, 0)).toMatchObject({ ratio: 0, flagged: false });
    expect(computeDrift(0, 5).flagged).toBe(true);
  });
});

describe("health checks", () => {
  it("account value thresholds", () => {
    expect(checkAccountValue(99.99).level).toBe("fail");
    expect(checkAccountValue(120).level).toBe("warn");
    expect(checkAccountValue(150).level).toBe("ok");
    expect(checkAccountValue(NaN).level).toBe("fail");
  });
  it("abstraction mode", () => {
    expect(checkAbstraction("disabled").level).toBe("ok");
    expect(checkAbstraction("default").level).toBe("ok");
    expect(checkAbstraction("unifiedAccount").level).toBe("fail");
    expect(checkAbstraction("portfolioMargin").level).toBe("fail");
  });
  it("fee config and approval", () => {
    expect(checkFeeConfig(100).level).toBe("ok");
    expect(checkFeeConfig(101).level).toBe("fail");
    expect(checkFeeConfig(-1).level).toBe("fail");
    expect(checkApproval(100, 50, "0xu").level).toBe("ok");
    expect(checkApproval(30, 50, "0xu").level).toBe("fail");
  });
  it("exit code ignores warnings", () => {
    expect(healthExitCode([{ name: "a", level: "warn", detail: "" }])).toBe(0);
    expect(healthExitCode([{ name: "a", level: "fail", detail: "" }])).toBe(1);
  });
});

describe("args and redaction", () => {
  it("parses flags", () => {
    const a = parseArgs(["--from", "20260101", "--execute", "--to=20260102", "pos"]);
    expect(a.flags.get("from")).toBe("20260101");
    expect(a.flags.get("execute")).toBe(true);
    expect(a.flags.get("to")).toBe("20260102");
    expect(a.positional).toEqual(["pos"]);
  });
  it("redacts private-key-like strings", () => {
    expect(redact(`oops 0x${"a1".repeat(32)} done`)).toBe("oops 0x[REDACTED] done");
    expect(redact(`addr 0x${"a1".repeat(20)}`)).toContain("0xa1a1");
  });
});
