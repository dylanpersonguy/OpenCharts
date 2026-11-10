import { describe, expect, it } from "vitest";
import { HL_ENDPOINTS } from "../config.ts";
import publicHeaders from "../../../public/_headers?raw";
import { buildCsp, buildHeadersFile, extraConnectFromEnv, originOf } from "../compliance/csp.ts";

describe("csp", () => {
  const directive = (csp: string, name: string): string[] =>
    (csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

  it("locks scripts to self and denies the dangerous defaults", () => {
    const csp = buildCsp();
    expect(directive(csp, "script-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'none'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
  });

  it("frame-ancestors is header-only", () => {
    expect(buildCsp()).not.toContain("frame-ancestors");
    expect(buildCsp({ header: true })).toContain("frame-ancestors 'none'");
  });

  it("connect-src covers every Hyperliquid endpoint the config can select", () => {
    const connect = directive(buildCsp(), "connect-src");
    for (const e of Object.values(HL_ENDPOINTS)) {
      expect(connect).toContain(new URL(e.rest).origin);
      expect(connect).toContain(`wss://${new URL(e.ws).host}`);
    }
  });

  it("derives extra origins from env URLs and ignores relative / bad ones", () => {
    const extra = extraConnectFromEnv({
      VITE_GEO_CHECK_URL: "https://geo.example.com/check?x=1",
      VITE_SCREEN_URL: "/api/screen",
      VITE_FEE_CONFIG_URL: "javascript:alert(1)",
      VITE_CSP_EXTRA_CONNECT: "https://a.example, https://b.example",
    });
    expect(extra).toEqual(["https://geo.example.com", "https://a.example", "https://b.example"]);
    expect(directive(buildCsp({ extraConnect: extra }), "connect-src")).toContain("https://geo.example.com");
    expect(originOf("not a url")).toBeUndefined();
  });

  it("public/_headers matches the generated default (no drift)", () => {
    const body = publicHeaders
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
    expect(body.trim()).toBe(buildHeadersFile().trim());
  });
});
