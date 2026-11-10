import { useState } from "react";
import { OpenChartsProvider } from "../../adapter/provider.tsx";
import { Terminal } from "../../terminal/Terminal.tsx";
import { createHyperliquidAdapter } from "../adapter.ts";
import { ComplianceGate } from "../compliance/index.ts";
import { HyperliquidShell } from "./HyperliquidShell.tsx";

/**
 * The complete Hyperliquid app: compliance gate, adapter, provider, shell and
 * terminal. This is what `Root` loads lazily. The gate sits OUTSIDE the provider
 * on purpose: until geo/terms checks pass, the provider (and so every network
 * connection) is not mounted.
 */
export default function HyperliquidApp() {
  const [adapter] = useState(() => createHyperliquidAdapter());
  return (
    <ComplianceGate>
      <OpenChartsProvider adapter={adapter}>
        <HyperliquidShell>
          <Terminal />
        </HyperliquidShell>
      </OpenChartsProvider>
    </ComplianceGate>
  );
}
